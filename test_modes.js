// E2E test: dm + zombie modes. Run: PORT=3126 node/bun test_modes.js (server must be running)
const { io } = require('socket.io-client');
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
  const b = { socket: s, name, team, you: null, round: null, infected: false, died: 0, respawned: 0, killFeed: [], updates: [] };
  s.on('connect', () => s.emit('join', { name, team, skin: 'default' }));
  s.on('init', (d) => { b.id = d.id; b.you = d.you; b.round = d.round; });
  s.on('you', (y) => { b.you = { ...b.you, ...y }; });
  s.on('round', (r) => { b.round = r; });
  s.on('infected', () => { b.infected = true; });
  s.on('died', () => b.died++);
  s.on('respawned', (r) => { if (r.id === b.id) b.respawned++; });
  s.on('kill', (k) => b.killFeed.push(k));
  s.on('player-update', (p) => b.updates.push(p));
  s.on('correct', (c) => { b.pos = c.pos; });
  return b;
}

function shootAt(shooter, victimId, n = 30) {
  return new Promise(async (res) => {
    for (let i = 0; i < n; i++) {
      shooter.socket.emit('shoot', { hits: [{ id: victimId, zone: 'head' }] });
      await sleep(160); // pistol rpm-safe
    }
    res();
  });
}

async function walkTo(b, target, maxMs = 12000) {
  const start = Date.now();
  b.pos = (b.pos || b.you.pos).slice();
  while (Date.now() - start < maxMs) {
    const dx = target[0] - b.pos[0], dz = target[2] - b.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 1.2) return true;
    const step = Math.min(0.55, d);
    b.pos = [b.pos[0] + dx / d * step, 0, b.pos[2] + dz / d * step];
    b.socket.emit('state', { pos: b.pos, yaw: 0, pitch: 0, anim: 'run', crouch: false });
    await sleep(34);
  }
  return false;
}

async function main() {
  console.log('--- joining 2 bots (comp warmup) ---');
  const a = bot('TesterA', 't');
  const c = bot('TesterB', 'ct');
  await sleep(1500);
  check('bots joined', a.id && c.id);
  check('mode in payload = comp', a.round && a.round.mode === 'comp');

  // ============ DEATHMATCH ============
  console.log('--- switch to dm ---');
  await api('mode', { mode: 'dm' });
  await sleep(600);
  check('round.mode = dm', a.round.mode === 'dm');
  // both teams present -> match starts immediately
  await sleep(1200);
  check('dm match live (no freeze)', a.round.phase === 'live');
  check('dm free money', a.you.money >= 16000);
  // buy mid-live
  a.socket.emit('buy', { weapon: 'ak47' });
  let buyOk = false; a.socket.once('buy-ok', () => { buyOk = true; });
  await sleep(500);
  check('dm buy anytime works', buyOk);
  // wait out spawn protection, walk into the open, then kill
  await sleep(3200);
  a.pos = a.you.pos.slice(); c.pos = c.you.pos.slice();
  const w1 = await walkTo(a, [0, 0, 14]);
  const w2 = await walkTo(c, [0, 0, 18]);
  check('dm bots walked to mid', w1 && w2);
  await shootAt(a, c.id, 4); // headshots: should kill quickly
  await sleep(600);
  check('dm kill counted in score', a.round.score.t >= 1);
  check('dm victim got died event', c.died >= 1);
  console.log('   waiting for dm respawn...');
  await sleep(4200);
  check('dm victim respawned', c.respawned >= 1);

  // ============ ZOMBIE ============
  console.log('--- switch to zombie ---');
  await api('mode', { mode: 'zombie' });
  await sleep(600);
  check('round.mode = zombie', a.round.mode === 'zombie');
  await sleep(1200);
  check('zombie freeze started', a.round.phase === 'freeze');
  await sleep(6500); // freezeMs 6000
  check('zombie live', a.round.phase === 'live');
  await sleep(800);
  const zombie = a.infected ? a : (c.infected ? c : null);
  const human = zombie === a ? c : a;
  check('exactly one bot infected', !!zombie && !(a.infected && c.infected));
  if (zombie) {
    check('zombie got knife-only loadout', zombie.you.weapon === 'knife');
    // zombie tries to buy -> fail
    let buyFail = false; zombie.socket.once('buy-fail', () => { buyFail = true; });
    zombie.socket.emit('buy', { weapon: 'ak47' });
    await sleep(400);
    check('zombie cannot buy', buyFail);
    // human shoots zombie dead -> zombie respawns (not round end)
    await sleep(2800); // spawn protection after conversion is 1.5s
    await shootAt(human, zombie.id, 12); // 150hp zombie, head pistol
    await sleep(700);
    const zombieDied = zombie.died >= 1;
    check('zombie can be killed by human', zombieDied);
    check('round still live after zombie death', human.round.phase === 'live');
    console.log('   waiting for zombie respawn...');
    await sleep(5800);
    check('zombie respawned', zombie.respawned >= 1);
    // zombie bites human: walk them together legally, then knife
    const mid = [0, 0, 18]; // open mid spot on arena
    zombie.pos = null; human.pos = null;
    // refresh authoritative positions: server sent 'you' on respawn
    zombie.pos = zombie.you.pos.slice(); human.pos = human.you.pos.slice();
    const ok1 = await walkTo(zombie, mid, 12000);
    const ok2 = await walkTo(human, mid, 12000);
    check('bots walked to mid', ok1 && ok2);
    let inf2 = false; human.socket.once('infected', () => { inf2 = true; });
    for (let i = 0; i < 8 && !inf2; i++) {
      zombie.socket.emit('shoot', { hits: [{ id: human.id, zone: 'head' }] });
      await sleep(600);
    }
    await sleep(800);
    check('human got infected by knife bite', inf2);
    check('round ended: all infected (zombies win)', human.round.phase === 'end' && human.round.winner === 't');
    await sleep(7500); // endMs 7000 -> next freeze
    check('next round freeze', human.round.phase === 'freeze');
    check('teams reset to human on freeze', human.updates.some((u) => u.team === 'ct'));
  }

  // back to comp
  await api('mode', { mode: 'comp' });
  await sleep(600);
  check('back to comp', a.round.mode === 'comp');

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  a.socket.disconnect(); c.socket.disconnect();
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
