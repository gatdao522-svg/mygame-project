// E2E test: rust mode (harvest + building). Run: PORT=3126 ADMIN_PASS=... bun test_rust.js
const { io } = require('socket.io-client');
const fs = require('fs');
const PORT = process.env.PORT || 3126;
const URL = `http://localhost:${PORT}`;
const ADMIN = process.env.ADMIN_PASS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
}

async function api(action, body) {
  const res = await fetch(`${URL}/api/admin/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-pass': ADMIN },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`${action}: ${res.status} ${await res.text()}`);
  return res.json();
}

function bot(name, team) {
  const s = io(URL, { transports: ['websocket'] });
  const b = { socket: s, name, team, you: null, round: null, init: null, harvested: [], resourceUpdates: [], blockAdds: [], blockRemoves: [], msgs: [] };
  s.on('connect', () => s.emit('join', { name, team, skin: 'default' }));
  s.on('init', (d) => { b.id = d.id; b.you = d.you; b.round = d.round; b.init = d; });
  s.on('you', (y) => { b.you = { ...b.you, ...y }; });
  s.on('round', (r) => { b.round = r; });
  s.on('harvested', (h) => b.harvested.push(h));
  s.on('resource-update', (u) => b.resourceUpdates.push(u));
  s.on('block-add', (blk) => b.blockAdds.push(blk));
  s.on('block-remove', (blk) => b.blockRemoves.push(blk));
  s.on('server-msg', (m) => b.msgs.push(m.text));
  s.on('correct', (c) => { b.pos = c.pos; });
  return b;
}

async function walkTo(b, target, maxMs = 40000) {
  const start = Date.now();
  b.pos = (b.pos || b.you.pos).slice();
  while (Date.now() - start < maxMs) {
    const dx = target[0] - b.pos[0], dz = target[2] - b.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 1.6) return true;
    const step = Math.min(0.55, d);
    b.pos = [b.pos[0] + dx / d * step, 0, b.pos[2] + dz / d * step];
    b.socket.emit('state', { pos: b.pos, yaw: 0, pitch: 0, anim: 'run', crouch: false, weapon: 'knife' });
    await sleep(34);
  }
  return false;
}

async function main() {
  const maps = JSON.parse(fs.readFileSync('public/maps.json', 'utf8'));
  const rustMap = maps.rust_island;

  console.log('--- switch to rust mode ---');
  await api('mode', { mode: 'rust' });
  await sleep(600);
  const st = await (await fetch(`${URL}/api/admin/state`, { headers: { 'x-admin-pass': ADMIN } })).json().catch(() => null);

  const b1 = bot('Harvester', 't');
  const b2 = bot('Builder', 'ct');
  await sleep(1500);
  check('bots joined', !!b1.id && !!b2.id);
  check('map switched to rust_island', b1.init.map === 'rust_island');
  check('round.mode = rust', b1.round.mode === 'rust');
  check('init has rust state', b1.init.rust && Array.isArray(b1.init.rust.blocks));
  check('start with 0 wood', b1.you.res && b1.you.res.wood === 0);

  // find tree nearest to b1 spawn
  const pos = b1.you.pos;
  let tree = null, best = 1e9;
  rustMap.resources.forEach(([type, x, z], id) => {
    if (type !== 'tree') return;
    const d = (x - pos[0]) ** 2 + (z - pos[2]) ** 2;
    if (d < best) { best = d; tree = { id, x, z }; }
  });
  console.log(`   nearest tree #${tree.id} at ${tree.x},${tree.z} (${Math.sqrt(best).toFixed(0)}u away)`);
  const walked = await walkTo(b1, [tree.x + 1.2, 0, tree.z + 1.2]);
  check('bot walked to tree', walked);

  console.log('--- harvest tree ---');
  b1.socket.emit('state', { pos: b1.pos, yaw: 0, pitch: 0, anim: 'idle', crouch: false, weapon: 'knife' });
  await sleep(200);
  const moneyBefore = b1.you.money;
  for (let i = 0; i < 3; i++) { b1.socket.emit('harvest', { id: tree.id }); await sleep(260); }
  await sleep(400);
  check('3 harvested events', b1.harvested.length === 3);
  check('got 30 wood', b1.you.res.wood === 30);
  check('harvest pays money', b1.you.money > moneyBefore);
  check('tree destroyed (60hp / 20dmg)', b1.resourceUpdates.some((u) => u.id === tree.id && u.alive === false));

  console.log('--- harvest dead tree rejected ---');
  const woodBefore = b1.you.res.wood;
  b1.socket.emit('harvest', { id: tree.id });
  await sleep(300);
  check('dead tree gives nothing', b1.you.res.wood === woodBefore);

  console.log('--- harvest out of range rejected ---');
  let far = null;
  rustMap.resources.forEach(([type, x, z], id) => {
    if (type === 'tree' && (x - b1.pos[0]) ** 2 + (z - b1.pos[2]) ** 2 > 900) far = far || id;
  });
  b1.socket.emit('harvest', { id: far });
  await sleep(300);
  check('far tree gives nothing', b1.you.res.wood === woodBefore);

  console.log('--- place block ---');
  const bx = +(b1.pos[0] + 2.2).toFixed(2), bz = +b1.pos[2].toFixed(2);
  b1.socket.emit('place-block', { x: bx, z: bz, horiz: false });
  await sleep(400);
  check('block-add broadcast', b1.blockAdds.length === 1 && b2.blockAdds.length === 1);
  check('wood deducted (30-15=15)', b1.you.res.wood === 15);

  console.log('--- overlapping block rejected ---');
  b1.socket.emit('place-block', { x: bx, z: bz, horiz: false });
  await sleep(400);
  check('no second block / no deduction', b1.blockAdds.length === 1 && b1.you.res.wood === 15);

  console.log('--- second block (spends last wood) ---');
  b1.socket.emit('place-block', { x: +(b1.pos[0] - 2.5).toFixed(2), z: bz, horiz: true });
  await sleep(400);
  check('second block placed, wood = 0', b1.blockAdds.length === 2 && b1.you.res.wood === 0);

  console.log('--- not enough wood rejected ---');
  b1.socket.emit('place-block', { x: +(b1.pos[0]).toFixed(2), z: +(b1.pos[2] - 3).toFixed(2), horiz: true });
  await sleep(400);
  check('block costs more than owned', b1.blockAdds.length === 2 && b1.msgs.some((m) => m.includes('дерева')));

  console.log('--- destroy block with knife ---');
  const blockId = b1.blockAdds[0].id;
  for (let i = 0; i < 8; i++) { b1.socket.emit('damage-block', { id: blockId }); await sleep(450); }
  check('block destroyed + broadcast', b1.blockRemoves.some((r) => r.id === blockId) && b2.blockRemoves.some((r) => r.id === blockId));

  console.log('--- resource respawn (45s) ---');
  await sleep(46000);
  check('tree respawned', b1.resourceUpdates.some((u) => u.id === tree.id && u.alive === true));

  console.log('--- back to comp ---');
  await api('mode', { mode: 'comp' });
  await sleep(600);
  check('back to comp', b1.round.mode === 'comp');

  b1.socket.close(); b2.socket.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
