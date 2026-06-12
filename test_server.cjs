// Server-logic integration test: join, round flow, movement, shooting, damage, kill, economy
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, team) {
  const s = io(URL, { transports: ['websocket'] });
  const st = { name, s, you: null, round: null, id: null, hp: 100, dead: false, kills: 0, events: [] };
  s.on('init', (d) => { st.id = d.id; st.you = d.you; st.round = d.round; st.pos = d.you.pos.slice(); });
  s.on('you', (y) => { st.you = y; if (y.pos) st.pos = y.pos.slice(); if (y.alive) st.dead = false; });
  s.on('round', (r) => { st.round = r; st.events.push(['round', r.phase]); });
  s.on('damaged', (d) => { st.hp = d.hp; st.events.push(['damaged', d.dmg]); });
  s.on('died', (d) => { st.dead = true; st.events.push(['died', d.by]); });
  s.on('kill', (k) => { if (k.killer === st.id) st.kills++; });
  s.on('reward', (d) => st.events.push(['reward', d.money]));
  s.on('buy-fail', (d) => st.events.push(['buy-fail', d.reason]));
  s.on('buy-ok', (d) => st.events.push(['buy-ok', d.weapon]));
  s.on('correct', (d) => { st.pos = d.pos.slice(); st.events.push(['correct']); });
  s.on('kicked', (d) => st.events.push(['kicked', d.reason]));
  s.on('connect', () => s.emit('join', { name, team }));
  return st;
}

// move a player toward target legally (small steps within speed budget)
async function walkTo(st, target, stepMs = 50) {
  for (let i = 0; i < 600; i++) {
    const [x, , z] = st.pos;
    const dx = target[0] - x, dz = target[2] - z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return true;
    const step = Math.min(0.28, dist); // ~5.6 m/s at 20Hz
    st.pos = [x + (dx / dist) * step, st.pos[1], z + (dz / dist) * step];
    st.s.emit('state', { pos: st.pos, yaw: 0, pitch: 0, anim: 'run', crouch: false, weapon: 'pistol' });
    await sleep(stepMs);
  }
  return false;
}

async function main() {
  const a = client('TestA', 't');
  const b = client('TestB', 'ct');
  await sleep(1500);
  console.log('A id', a.id, 'phase', a.round.phase, 'A pos', a.pos, 'B pos', b.pos);
  if (!a.id || !b.id) throw new Error('join failed');

  // wait for live phase
  for (let i = 0; i < 40 && a.round.phase !== 'live'; i++) await sleep(500);
  console.log('phase:', a.round.phase);
  if (a.round.phase !== 'live') throw new Error('never went live');

  // walk both to open mid (0, z) — arena mid should be reachable-ish; use straight line, ignore walls (server has no wall collision for movement, only speed checks)
  await Promise.all([walkTo(a, [2, 0, 0]), walkTo(b, [-2, 0, 0])]);
  console.log('met at mid. A', a.pos, 'B', b.pos);

  // A shoots B: dir from A to B
  const dir = [b.pos[0] - a.pos[0], 0, b.pos[2] - a.pos[2]];
  const len = Math.hypot(...dir);
  const nd = [dir[0] / len, 0, dir[2] / len];
  const origin = [a.pos[0], a.pos[1] + 1.62, a.pos[2]];
  for (let i = 0; i < 14 && !b.dead; i++) {
    a.s.emit('shoot', { origin, dir: nd, hits: [{ id: b.id, zone: 'body' }] });
    await sleep(180); // pistol fire rate
  }
  await sleep(500);
  console.log('B hp:', b.hp, 'B dead:', b.dead, 'A kills:', a.kills);
  console.log('B events:', JSON.stringify(b.events.slice(-6)));
  console.log('A events:', JSON.stringify(a.events.slice(-6)));
  if (!b.dead) throw new Error('B did not die from legit shots');
  if (a.kills !== 1) throw new Error('kill not credited');

  // round should end (elimination, 1v1)
  for (let i = 0; i < 20 && a.round.phase === 'live'; i++) await sleep(400);
  console.log('phase after kill:', a.round.phase, 'score:', JSON.stringify(a.round.score));
  if (!['end', 'freeze'].includes(a.round.phase)) throw new Error('round did not end after elimination');
  if (a.round.score.t !== 1) throw new Error('T should have 1 round win');

  // wait for next freeze, check money rewards (win 3250 + kill 300 + start 800 = 4350; lose 1900+800=2700)
  for (let i = 0; i < 30 && a.round.phase !== 'freeze'; i++) await sleep(400);
  await sleep(300);
  console.log('A money:', a.you.money, 'B money:', b.you.money);
  if (a.you.money < 3000) throw new Error('winner money too low');

  // buy test in freeze: A buys ak47 (afford now)
  a.s.emit('buy', { weapon: 'ak47' });
  await sleep(400);
  console.log('A loadout:', JSON.stringify(a.you.loadout), 'money:', a.you.money);
  if (a.you.loadout.primary !== 'ak47') throw new Error('ak47 buy failed');

  // anticheat: teleport check — B sends far pos
  const before = b.pos.slice();
  b.s.emit('state', { pos: [before[0] + 40, 0, before[2] + 40], yaw: 0, pitch: 0, anim: 'run', crouch: false, weapon: 'pistol' });
  await sleep(400);
  const corrected = b.events.some((e) => e[0] === 'correct');
  console.log('teleport corrected:', corrected);

  // rate-limit: spam chat
  for (let i = 0; i < 5; i++) a.s.emit('chat', 'spam' + i);
  await sleep(300);

  a.s.disconnect(); b.s.disconnect();
  console.log('SERVER TEST PASSED');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
