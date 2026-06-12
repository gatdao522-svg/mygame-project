// ===== STRIKE ARENA server v2 =====
// Server-authoritative: ammo, damage, economy, rounds, anticheat, rate limits, admin API.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || crypto.randomBytes(9).toString('base64url');
if (!process.env.ADMIN_PASS) console.log(`[admin] generated password: ${ADMIN_PASS}`);

// Behind a reverse proxy (Railway etc.) the real client IP is the LAST entry of
// x-forwarded-for added by the trusted proxy. Never trust the first entry — bots
// can spoof it and bypass per-IP limits and bans. Set TRUST_PROXY=0 for bare metal.
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const MAX_PLAYERS = Math.max(2, parseInt(process.env.MAX_PLAYERS || '16', 10) || 16);
const MAX_CONN_PER_IP = Math.max(1, parseInt(process.env.MAX_CONN_PER_IP || '3', 10) || 3);

const MAPS = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'maps.json'), 'utf8'));
const DATA_DIR = path.join(__dirname, 'data');
const BANS_FILE = path.join(DATA_DIR, 'bans.json');

let CFG = null; // loaded from public/js/config.js (ESM) at boot

// ---------- logging ring buffer (for admin panel) ----------
const LOGS = [];
function slog(type, msg) {
  const line = { t: Date.now(), type, msg };
  LOGS.push(line);
  if (LOGS.length > 300) LOGS.shift();
  console.log(`[${type}] ${msg}`);
}

// ---------- bans ----------
let bans = {}; // ip -> {name, at, reason}
try { bans = JSON.parse(fs.readFileSync(BANS_FILE, 'utf8')); } catch { bans = {}; }
function saveBans() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(BANS_FILE, JSON.stringify(bans)); } catch (e) { console.warn('bans save fail', e.message); }
}

// ---------- colliders (mirror of client map.js geometry) ----------
function buildColliders(map) {
  const out = [];
  const add = (cx, cy, cz, w, h, d) => out.push([cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2]);
  for (const [cx, cz, w, d, h, y0 = 0] of map.walls) add(cx, y0 + h / 2, cz, w, h, d);
  for (const [cx, cz, w, d, h] of map.lows) add(cx, h / 2, cz, w, h, d);
  for (const [cx, cz, size, stack] of map.crates) {
    for (let s = 0; s < stack; s++) add(cx, size / 2 + s * size, cz, size + 0.1, size, size + 0.1);
  }
  for (const [cx, cz, w, d, h, stairDir] of map.platforms) {
    add(cx, h / 2, cz, w, h, d);
    const steps = Math.max(4, Math.ceil(h / 0.5)), stepH = h / steps, stepD = 0.9;
    for (let i = 0; i < steps; i++) {
      const sh = h - i * stepH;
      const offset = (w / 2) + stepD / 2 + i * stepD;
      const sx = stairDir === 'E' ? cx + offset : cx - offset;
      add(sx, sh / 2, cz, stepD, sh, d);
    }
  }
  return out;
}

// segment vs AABB (slab method); ignores boxes the segment starts inside
function segHitsBox(ax, ay, az, bx, by, bz, box) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let tmin = 0, tmax = 1;
  const axes = [[ax, dx, box[0], box[3]], [ay, dy, box[1], box[4]], [az, dz, box[2], box[5]]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmin > 0.001; // started inside -> doesn't count as blocked
}
function losBlocked(colliders, from, to) {
  for (const box of colliders) {
    if (segHitsBox(from[0], from[1], from[2], to[0], to[1], to[2], box)) return true;
  }
  return false;
}

// ---------- game state ----------
const ROTATION = Object.keys(MAPS);
let mapId = 'arena';
let colliders = buildColliders(MAPS[mapId]);
const players = new Map(); // socket.id -> player
const ipConns = new Map(); // ip -> count

// ---------- anti bot-flood ----------
const connAttempts = new Map(); // ip -> [timestamps] (rolling window)
const tempBlocks = new Map();   // ip -> unblockAt
const FLOOD_WINDOW_MS = 30000;
const FLOOD_MAX_ATTEMPTS = 10;       // connects per window before temp block
const FLOOD_BLOCK_MS = 2 * 60000;    // temp block duration
const JOIN_TIMEOUT_MS = 10000;       // connected sockets must join or get dropped

function floodCheck(ip) {
  const t = Date.now();
  const ub = tempBlocks.get(ip);
  if (ub) {
    if (t < ub) return false;
    tempBlocks.delete(ip);
  }
  let arr = connAttempts.get(ip);
  if (!arr) { arr = []; connAttempts.set(ip, arr); }
  while (arr.length && t - arr[0] > FLOOD_WINDOW_MS) arr.shift();
  arr.push(t);
  if (arr.length > FLOOD_MAX_ATTEMPTS) {
    tempBlocks.set(ip, t + FLOOD_BLOCK_MS);
    slog('anticheat', `temp-block ${ip} — connection flood (${arr.length} in 30s)`);
    return false;
  }
  return true;
}
setInterval(() => { // GC stale flood entries
  const t = Date.now();
  for (const [ip, arr] of connAttempts) if (!arr.length || t - arr[arr.length - 1] > FLOOD_WINDOW_MS) connAttempts.delete(ip);
  for (const [ip, ub] of tempBlocks) if (t > ub) tempBlocks.delete(ip);
}, 60000);

const round = {
  phase: 'warmup', // warmup | freeze | live | end | matchend
  endsAt: 0,
  liveStartAt: 0,
  roundNo: 0,
  score: { t: 0, ct: 0 },
  winner: null,
};

function now() { return Date.now(); }
function mapBounds() { const [w, d] = MAPS[mapId].size; return { x: w / 2 + 2, z: d / 2 + 2 }; }

function spawnPos(team) {
  const list = MAPS[mapId].spawns[team];
  const s = list[Math.floor(Math.random() * list.length)];
  return [s[0] + (Math.random() - 0.5) * 1.2, 0, s[2] + (Math.random() - 0.5) * 1.2];
}

function freshAmmo(wid) {
  const w = CFG.WEAPONS[wid];
  return { mag: w.mag === Infinity ? -1 : w.mag, reserve: w.reserve === Infinity ? -1 : w.reserve };
}

function resetPlayerForRound(p, full) {
  p.alive = true;
  p.hp = 100;
  p.pos = spawnPos(p.team);
  p.protectedUntil = now() + CFG.ROUND.spawnProtectMs;
  p.reloadUntil = 0;
  if (full) {
    p.loadout = { primary: null, secondary: 'pistol' };
    p.weapon = 'pistol';
  }
  p.ammo = {};
  for (const slot of ['primary', 'secondary']) {
    if (p.loadout[slot]) p.ammo[p.loadout[slot]] = freshAmmo(p.loadout[slot]);
  }
  p.ammo.knife = freshAmmo('knife');
  if (!p.loadout[CFG.WEAPONS[p.weapon]?.slot] && p.weapon !== 'knife') p.weapon = p.loadout.secondary || 'knife';
}

function teamCounts() {
  let t = 0, ct = 0, tAlive = 0, ctAlive = 0;
  for (const p of players.values()) {
    if (p.team === 't') { t++; if (p.alive) tAlive++; }
    else { ct++; if (p.alive) ctAlive++; }
  }
  return { t, ct, tAlive, ctAlive };
}

function roundPayload() {
  return {
    phase: round.phase, endsAt: round.endsAt, roundNo: round.roundNo,
    score: round.score, winner: round.winner, mapId,
    buyUntil: round.liveStartAt ? round.liveStartAt - CFG.ROUND.freezeMs + CFG.ROUND.buyMs : 0,
  };
}
function broadcastRound(extra = {}) {
  io.emit('round', { ...roundPayload(), ...extra });
}

function startMatch() {
  round.roundNo = 0;
  round.score = { t: 0, ct: 0 };
  for (const p of players.values()) p.money = CFG.ECONOMY.start;
  startFreeze(true);
  slog('round', 'match started');
}

function startFreeze(fullReset) {
  round.phase = 'freeze';
  round.roundNo++;
  round.winner = null;
  round.endsAt = now() + CFG.ROUND.freezeMs;
  round.liveStartAt = round.endsAt;
  for (const p of players.values()) {
    resetPlayerForRound(p, fullReset);
    sendPrivate(p);
  }
  broadcastRound();
}

function startLive() {
  round.phase = 'live';
  round.endsAt = now() + CFG.ROUND.liveMs;
  broadcastRound();
}

function endRound(winner, reason) {
  if (round.phase === 'end' || round.phase === 'matchend') return;
  round.phase = 'end';
  round.winner = winner;
  round.endsAt = now() + CFG.ROUND.endMs;
  if (winner) {
    round.score[winner]++;
    for (const p of players.values()) {
      const win = p.team === winner;
      p.money = Math.min(CFG.ECONOMY.max, p.money + (win ? CFG.ECONOMY.winReward : CFG.ECONOMY.loseReward));
      sendPrivate(p);
    }
  }
  slog('round', `round ${round.roundNo} won by ${winner || 'nobody'} (${reason}) — T ${round.score.t}:${round.score.ct} CT`);
  broadcastRound({ reason });
}

function checkRoundWin() {
  if (round.phase !== 'live') return;
  const c = teamCounts();
  if (c.t === 0 || c.ct === 0) { toWarmup(); return; }
  if (c.tAlive === 0) endRound('ct', 'elimination');
  else if (c.ctAlive === 0) endRound('t', 'elimination');
}

function toWarmup() {
  round.phase = 'warmup';
  round.roundNo = 0;
  round.score = { t: 0, ct: 0 };
  round.winner = null;
  round.endsAt = 0;
  for (const p of players.values()) {
    p.money = CFG.ECONOMY.start;
    resetPlayerForRound(p, false);
    sendPrivate(p);
  }
  broadcastRound();
  slog('round', 'back to warmup');
}

// round tick
setInterval(() => {
  if (!CFG) return;
  const t = now();
  const c = teamCounts();
  if (round.phase === 'warmup') {
    if (c.t >= 1 && c.ct >= 1 && players.size >= 2) startMatch();
    // warmup respawns
    for (const p of players.values()) {
      if (!p.alive && t > p.respawnAt) { resetPlayerForRound(p, false); sendPrivate(p); io.emit('respawned', { id: p.id, pos: p.pos }); }
    }
    return;
  }
  if (c.t === 0 || c.ct === 0 || players.size < 2) { toWarmup(); return; }
  if (round.phase === 'freeze' && t >= round.endsAt) startLive();
  else if (round.phase === 'live' && t >= round.endsAt) endRound('ct', 'timeout');
  else if (round.phase === 'end' && t >= round.endsAt) {
    if (round.score.t >= CFG.ROUND.winsToFinish || round.score.ct >= CFG.ROUND.winsToFinish) {
      round.phase = 'matchend';
      round.endsAt = t + 12000;
      round.winner = round.score.t > round.score.ct ? 't' : 'ct';
      broadcastRound();
      slog('round', `MATCH OVER: ${round.winner} wins`);
    } else startFreeze(false);
  } else if (round.phase === 'matchend' && t >= round.endsAt) startMatch();
}, 250);

// ---------- helpers ----------
function sendPrivate(p) {
  const sock = io.sockets.sockets.get(p.id);
  if (!sock) return;
  sock.emit('you', {
    money: p.money, loadout: p.loadout, ammo: p.ammo, weapon: p.weapon,
    hp: p.hp, alive: p.alive, pos: p.pos, protectedUntil: p.protectedUntil,
  });
}

function settleReload(p) {
  if (p.reloadUntil && now() >= p.reloadUntil) {
    const wid = p.reloadingWeapon;
    const w = CFG.WEAPONS[wid];
    const a = p.ammo[wid];
    if (w && a && a.mag >= 0) {
      const need = w.mag - a.mag;
      const take = a.reserve < 0 ? need : Math.min(need, a.reserve);
      a.mag += take;
      if (a.reserve > 0) a.reserve -= take;
    }
    p.reloadUntil = 0;
    p.reloadingWeapon = null;
  }
}

function flag(p, type) {
  p.flags[type] = (p.flags[type] || 0) + 1;
  p.flagsTotal++;
  if (p.flagsTotal === 15 || p.flagsTotal === 40) slog('anticheat', `${p.name} (${p.ip}) suspicious: ${JSON.stringify(p.flags)}`);
  if (p.flagsTotal > 80) {
    slog('anticheat', `auto-kick ${p.name} (${p.ip}) — too many violations ${JSON.stringify(p.flags)}`);
    kickPlayer(p.id, 'Античит: слишком много нарушений');
  }
}

function kickPlayer(id, reason) {
  const sock = io.sockets.sockets.get(id);
  if (sock) { sock.emit('kicked', { reason }); sock.disconnect(true); }
}

const VALID_SKINS = () => Object.keys(CFG.SKINS);

// ---------- express ----------
const app = express();
app.use(express.json({ limit: '16kb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/healthz', (req, res) => res.json({ ok: true, players: players.size, map: mapId, phase: round.phase }));

// ----- admin API -----
const adminFails = new Map(); // ip -> {n, resetAt}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
function adminAuth(req, res, next) {
  const ip = clientIp(req);
  const f = adminFails.get(ip);
  if (f && f.n >= 8 && now() < f.resetAt) return res.status(429).json({ error: 'Слишком много попыток. Подожди минуту.' });
  const pass = req.headers['x-admin-pass'] || '';
  const ok = pass.length === ADMIN_PASS.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(ADMIN_PASS));
  if (!ok) {
    const cur = adminFails.get(ip) || { n: 0, resetAt: 0 };
    cur.n++; cur.resetAt = now() + 60000;
    adminFails.set(ip, cur);
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  adminFails.delete(ip);
  next();
}

app.post('/api/admin/login', adminAuth, (req, res) => res.json({ ok: true }));

app.get('/api/admin/state', adminAuth, (req, res) => {
  res.json({
    map: mapId, maps: Object.keys(MAPS).map((id) => ({ id, label: MAPS[id].label })),
    phase: round.phase, score: round.score, roundNo: round.roundNo,
    uptime: Math.round(process.uptime()),
    players: [...players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths,
      money: p.money, hp: p.hp, alive: p.alive, ip: p.ip, muted: !!p.muted,
      flags: p.flagsTotal, skin: p.skin,
    })),
    bans: Object.entries(bans).map(([ip, b]) => ({ ip, ...b })),
    logs: LOGS.slice(-80),
  });
});

app.post('/api/admin/kick', adminAuth, (req, res) => {
  const p = players.get(String(req.body.id || ''));
  if (!p) return res.status(404).json({ error: 'Игрок не найден' });
  slog('admin', `kick ${p.name} (${p.ip})`);
  kickPlayer(p.id, 'Кикнут админом');
  res.json({ ok: true });
});

app.post('/api/admin/ban', adminAuth, (req, res) => {
  let ip = String(req.body.ip || '');
  let name = '';
  if (req.body.id) {
    const p = players.get(String(req.body.id));
    if (!p) return res.status(404).json({ error: 'Игрок не найден' });
    ip = p.ip; name = p.name;
  }
  if (!ip) return res.status(400).json({ error: 'Нужен ip или id' });
  bans[ip] = { name, at: now(), reason: String(req.body.reason || 'ban') };
  saveBans();
  slog('admin', `ban ${ip} ${name}`);
  for (const p of players.values()) if (p.ip === ip) kickPlayer(p.id, 'Забанен админом');
  res.json({ ok: true });
});

app.post('/api/admin/unban', adminAuth, (req, res) => {
  const ip = String(req.body.ip || '');
  delete bans[ip]; saveBans();
  slog('admin', `unban ${ip}`);
  res.json({ ok: true });
});

app.post('/api/admin/mute', adminAuth, (req, res) => {
  const p = players.get(String(req.body.id || ''));
  if (!p) return res.status(404).json({ error: 'Игрок не найден' });
  p.muted = !!req.body.on;
  slog('admin', `${p.muted ? 'mute' : 'unmute'} ${p.name}`);
  res.json({ ok: true });
});

app.post('/api/admin/map', adminAuth, (req, res) => {
  const id = String(req.body.map || '');
  if (!MAPS[id]) return res.status(400).json({ error: 'Нет такой карты' });
  changeMap(id);
  res.json({ ok: true });
});

app.post('/api/admin/restart', adminAuth, (req, res) => {
  slog('admin', 'round restart');
  if (round.phase === 'warmup') { toWarmup(); } else startFreeze(false);
  res.json({ ok: true });
});

app.post('/api/admin/resetmatch', adminAuth, (req, res) => {
  slog('admin', 'match reset');
  const c = teamCounts();
  if (c.t >= 1 && c.ct >= 1) startMatch(); else toWarmup();
  res.json({ ok: true });
});

app.post('/api/admin/say', adminAuth, (req, res) => {
  const text = String(req.body.text || '').slice(0, 200);
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  io.emit('server-msg', { text });
  slog('admin', `say: ${text}`);
  res.json({ ok: true });
});

function changeMap(id) {
  mapId = id;
  colliders = buildColliders(MAPS[mapId]);
  slog('admin', `map -> ${id}`);
  io.emit('map-change', { map: id });
  // players will reconnect after reload
  round.phase = 'warmup'; round.score = { t: 0, ct: 0 }; round.roundNo = 0;
}

// ---------- socket.io ----------
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 4096, pingTimeout: 20000 });

function realIp(socket) {
  if (TRUST_PROXY) {
    const xff = String(socket.handshake.headers['x-forwarded-for'] || '');
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]; // last hop = added by trusted proxy
  }
  return socket.handshake.address || '?';
}

io.use((socket, next) => {
  const ip = realIp(socket);
  socket.data.ip = ip;
  if (bans[ip]) return next(new Error('banned'));
  if (!floodCheck(ip)) return next(new Error('rate limited'));
  if ((ipConns.get(ip) || 0) >= MAX_CONN_PER_IP) return next(new Error('too many connections'));
  next();
});

io.on('connection', (socket) => {
  const ip = socket.data.ip;
  ipConns.set(ip, (ipConns.get(ip) || 0) + 1);
  let joined = false;

  // drop zombie sockets that connect but never join (bot floods)
  const joinTimer = setTimeout(() => {
    if (!joined) { slog('anticheat', `drop idle socket ${ip} (no join in ${JOIN_TIMEOUT_MS / 1000}s)`); socket.disconnect(true); }
  }, JOIN_TIMEOUT_MS);

  socket.on('join', (data) => {
    if (joined || typeof data !== 'object' || !data) return;
    if (players.size >= MAX_PLAYERS) {
      socket.emit('join-fail', { reason: `Сервер полон (${MAX_PLAYERS} игроков)` });
      socket.disconnect(true);
      return;
    }
    joined = true;
    clearTimeout(joinTimer);
    let name = String(data.name || '').replace(/[<>\n\r\t]/g, '').trim().slice(0, 16) || `Игрок${Math.floor(Math.random() * 900) + 100}`;
    let team = data.team === 't' || data.team === 'ct' ? data.team : null;
    if (!team) { const c = teamCounts(); team = c.t <= c.ct ? 't' : 'ct'; }
    const skin = VALID_SKINS().includes(data.skin) ? data.skin : 'default';

    const p = {
      id: socket.id, ip, name, team, skin,
      pos: spawnPos(team), yaw: 0, pitch: 0, anim: 'idle', crouch: false,
      hp: 100, alive: true, kills: 0, deaths: 0,
      money: round.phase === 'warmup' ? CFG.ECONOMY.start : CFG.ECONOMY.start,
      loadout: { primary: null, secondary: 'pistol' }, weapon: 'pistol',
      ammo: { pistol: freshAmmo('pistol'), knife: freshAmmo('knife') },
      reloadUntil: 0, reloadingWeapon: null,
      lastShotAt: {}, protectedUntil: now() + CFG.ROUND.spawnProtectMs,
      respawnAt: 0, muted: false,
      posHist: [], // [{t, pos, crouch}] for lag-compensated hit validation
      flags: {}, flagsTotal: 0,
      stateBudget: 40, stateBudgetAt: now(),
      lastChatAt: 0, lastStateT: now(),
    };
    // joining mid-round: wait for next round
    if (round.phase === 'live' || round.phase === 'end') {
      p.alive = false;
      p.deadUntilRound = true;
    }
    players.set(socket.id, p);
    slog('join', `${name} [${team}] ${ip} (${players.size} online)`);

    socket.emit('init', {
      id: socket.id, map: mapId,
      round: roundPayload(),
      players: [...players.values()].map(pub),
      you: { money: p.money, loadout: p.loadout, ammo: p.ammo, weapon: p.weapon, hp: p.hp, alive: p.alive, pos: p.pos, protectedUntil: p.protectedUntil, skin: p.skin },
    });
    socket.join('game');
    socket.broadcast.emit('player-joined', pub(p));
    io.emit('server-msg', { text: `${name} зашёл в игру` });
  });

  socket.on('state', (s) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || typeof s !== 'object' || !s || !Array.isArray(s.pos)) return;
    // rate limit: 40 msg/s budget
    const t = now();
    if (t - p.stateBudgetAt > 1000) { p.stateBudget = 40; p.stateBudgetAt = t; }
    if (--p.stateBudget < 0) { flag(p, 'state-spam'); return; }

    const [x, y, z] = s.pos.map(Number);
    if (![x, y, z].every(Number.isFinite)) { flag(p, 'bad-data'); return; }

    // freeze: no movement
    if (round.phase === 'freeze' || (round.phase === 'matchend')) {
      // hold position, allow look
      p.yaw = Number(s.yaw) || 0; p.pitch = Number(s.pitch) || 0;
      return;
    }

    // speed / teleport check
    const dt = Math.min(0.5, Math.max(0.015, (t - p.lastStateT) / 1000));
    p.lastStateT = t;
    const dx = x - p.pos[0], dz = z - p.pos[2];
    const dist = Math.hypot(dx, dz);
    const maxDist = CFG.PLAYER.runSpeed * 1.7 * dt + 0.4;
    const b = mapBounds();
    if (dist > maxDist + 2.5 || Math.abs(x) > b.x || Math.abs(z) > b.z || y < -3 || y > 30) {
      flag(p, 'teleport');
      socket.emit('correct', { pos: p.pos });
      return;
    }
    if (dist > maxDist) { flag(p, 'speed'); } // soft flag, accept small overage

    p.pos = [x, y, z];
    p.posHist.push({ t, pos: [x, y, z], crouch: !!s.crouch });
    while (p.posHist.length && t - p.posHist[0].t > 600) p.posHist.shift();
    p.yaw = Number(s.yaw) || 0;
    p.pitch = Number(s.pitch) || 0;
    p.anim = typeof s.anim === 'string' ? s.anim.slice(0, 10) : 'idle';
    p.crouch = !!s.crouch;
    // weapon switch validation
    if (typeof s.weapon === 'string' && s.weapon !== p.weapon && CFG.WEAPONS[s.weapon]) {
      const w = CFG.WEAPONS[s.weapon];
      const owned = s.weapon === 'knife' || p.loadout[w.slot] === s.weapon;
      if (owned) { p.weapon = s.weapon; p.reloadUntil = 0; p.reloadingWeapon = null; }
      else flag(p, 'weapon-not-owned');
    }
  });

  socket.on('shoot', (data) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !CFG || typeof data !== 'object' || !data) return;
    const t = now();
    if (round.phase === 'freeze' || round.phase === 'matchend') return;
    const wid = p.weapon;
    const w = CFG.WEAPONS[wid];
    if (!w) return;
    settleReload(p);
    if (p.reloadUntil) return; // mid-reload
    // fire rate (allow 25% tolerance for jitter)
    const minGap = (60000 / w.rpm) * 0.72;
    if (p.lastShotAt[wid] && t - p.lastShotAt[wid] < minGap) { flag(p, 'fire-rate'); return; }
    // ammo
    const a = p.ammo[wid];
    if (!a) return;
    if (a.mag === 0) return;
    if (a.mag > 0) a.mag--;
    p.lastShotAt[wid] = t;
    if (t < p.protectedUntil) { p.protectedUntil = 0; sendPrivate(p); } // shooting drops your protection

    // broadcast shot for sound/visuals
    socket.broadcast.emit('shot', { id: p.id, weapon: wid });

    // ----- validate hit claims -----
    let hits = Array.isArray(data.hits) ? data.hits.slice(0, 8) : [];
    if (w.pellets) {
      let totalPellets = 0;
      for (const h of hits) totalPellets += Math.max(1, Math.min(8, Number(h.pellets) || 1));
      if (totalPellets > w.pellets) { flag(p, 'pellets'); return; }
    } else if (hits.length > 1) { flag(p, 'multi-hit'); hits = hits.slice(0, 1); }

    const eye = [p.pos[0], p.pos[1] + (p.crouch ? CFG.PLAYER.eyeCrouch : CFG.PLAYER.eyeStand), p.pos[2]];
    // lag compensation: the shooter aimed at where the victim was ~INTERP_DELAY + jitter
    // ago, so validate against the victim's recent position history, not just "now".
    const REWIND_MS = 200, REWIND_MAX_MS = 450;
    function rewindStates(victim) {
      const out = [{ pos: victim.pos, crouch: victim.crouch }];
      let best = null;
      for (const hsnap of victim.posHist) {
        const age = t - hsnap.t;
        if (age > REWIND_MAX_MS) continue;
        if (!best || Math.abs(age - REWIND_MS) < Math.abs(t - best.t - REWIND_MS)) best = hsnap;
      }
      if (best && best.pos !== victim.pos) out.push({ pos: best.pos, crouch: best.crouch });
      return out;
    }
    function bodyPoints(pos, crouch) {
      const headY = crouch ? 1.11 : 1.66, chestY = crouch ? 0.78 : 1.2;
      return {
        head: [pos[0], pos[1] + headY, pos[2]],
        chest: [pos[0], pos[1] + chestY, pos[2]],
        pelvis: [pos[0], pos[1] + 0.55, pos[2]],
      };
    }
    for (const h of hits) {
      if (typeof h !== 'object' || !h) continue;
      const victim = players.get(String(h.id || ''));
      if (!victim || !victim.alive || victim.id === p.id) continue;
      if (victim.team === p.team) { flag(p, 'team-dmg'); continue; }
      if (t < victim.protectedUntil) { socket.emit('hit-protected', { id: victim.id }); continue; }
      // validate distance + LOS against current AND rewound position; accept if either passes
      let dist = Infinity, valid = false;
      for (const st of rewindStates(victim)) {
        const dx = st.pos[0] - p.pos[0], dy = st.pos[1] - p.pos[1], dz = st.pos[2] - p.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > w.range * 1.2) continue;
        const pts = bodyPoints(st.pos, st.crouch);
        if (losBlocked(colliders, eye, pts.chest) && losBlocked(colliders, eye, pts.head) && losBlocked(colliders, eye, pts.pelvis)) continue;
        valid = true;
        dist = Math.min(dist, d);
      }
      if (!valid) {
        // distinguish flags for the admin log
        const dNow = Math.hypot(victim.pos[0] - p.pos[0], victim.pos[1] - p.pos[1], victim.pos[2] - p.pos[2]);
        flag(p, dNow > w.range * 1.2 ? 'range' : 'wallhack');
        continue;
      }

      const zone = h.zone === 'head' ? 'head' : (h.zone === 'legs' ? 'legs' : 'body');
      const pelletN = w.pellets ? Math.max(1, Math.min(8, Number(h.pellets) || 1)) : 1;
      let dmg = w.dmg * pelletN;
      if (zone === 'head') dmg *= (w.headMul || 2);
      else if (zone === 'legs') dmg *= 0.75;
      // distance falloff beyond 60% of range
      if (dist > w.range * 0.6 && w.range < 400) dmg *= Math.max(0.55, 1 - (dist - w.range * 0.6) / w.range);
      dmg = Math.round(dmg);

      victim.hp -= dmg;
      const dirAngle = Math.atan2(p.pos[0] - victim.pos[0], p.pos[2] - victim.pos[2]);
      io.to(victim.id).emit('damaged', { hp: victim.hp, by: p.id, dirAngle, dmg });
      socket.emit('hit-confirm', { id: victim.id, zone, dmg, hp: victim.hp });

      if (victim.hp <= 0) {
        victim.alive = false;
        victim.deaths++;
        victim.respawnAt = t + 3500; // only used in warmup
        p.kills++;
        const reward = w.killReward ?? 300;
        p.money = Math.min(CFG.ECONOMY.max, p.money + reward);
        io.emit('kill', {
          killer: p.id, killerName: p.name, killerTeam: p.team,
          victim: victim.id, victimName: victim.name, victimTeam: victim.team,
          weapon: wid, headshot: zone === 'head',
        });
        io.to(victim.id).emit('died', { by: p.name, waitRound: round.phase !== 'warmup' });
        socket.emit('reward', { money: p.money, delta: reward });
        checkRoundWin();
        if (!victim.alive && round.phase === 'warmup') { /* tick respawns */ }
        break; // one kill per shot is enough to stop processing further hits on same victim
      }
    }
  });

  socket.on('reload', () => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !CFG) return;
    settleReload(p);
    if (p.reloadUntil) return;
    const w = CFG.WEAPONS[p.weapon];
    const a = p.ammo[p.weapon];
    if (!w || !a || a.mag < 0 || a.mag >= w.mag || a.reserve === 0) return;
    p.reloadUntil = now() + w.reloadMs;
    p.reloadingWeapon = p.weapon;
    socket.broadcast.emit('reloading', { id: p.id });
  });

  socket.on('buy', (data) => {
    const p = players.get(socket.id);
    if (!p || !CFG || typeof data !== 'object' || !data) return;
    const wid = String(data.weapon || '');
    const w = CFG.WEAPONS[wid];
    const t = now();
    const fail = (reason) => socket.emit('buy-fail', { reason });
    if (!w || w.slot === 'melee') return fail('Нельзя купить');
    const buyOpen = round.phase === 'warmup' || round.phase === 'freeze' ||
      (round.phase === 'live' && t < round.liveStartAt - CFG.ROUND.freezeMs + CFG.ROUND.buyMs);
    if (!buyOpen) return fail('Время покупки вышло');
    if (!p.alive) return fail('Ты мёртв');
    const free = round.phase === 'warmup';
    if (!free && p.money < w.price) return fail('Не хватает денег');
    if (p.loadout[w.slot] === wid) {
      // rebuy ammo refill
      p.ammo[wid] = freshAmmo(wid);
    } else {
      p.loadout[w.slot] = wid;
      p.ammo[wid] = freshAmmo(wid);
      p.weapon = wid;
    }
    if (!free) p.money -= w.price;
    sendPrivate(p);
    socket.emit('buy-ok', { weapon: wid });
  });

  socket.on('skin', (data) => {
    const p = players.get(socket.id);
    if (!p || typeof data !== 'object' || !data) return;
    if (VALID_SKINS().includes(data.skin)) p.skin = data.skin;
  });

  socket.on('chat', (text) => {
    const p = players.get(socket.id);
    if (!p) return;
    const t = now();
    if (t - p.lastChatAt < 1500) { flag(p, 'chat-spam'); return; }
    if (p.muted) { socket.emit('server-msg', { text: 'Ты замучен админом' }); return; }
    p.lastChatAt = t;
    const msg = String(text || '').replace(/[<>]/g, '').trim().slice(0, 120);
    if (!msg) return;
    io.emit('chat', { id: p.id, name: p.name, team: p.team, text: msg });
  });

  socket.on('disconnect', () => {
    clearTimeout(joinTimer);
    ipConns.set(ip, Math.max(0, (ipConns.get(ip) || 1) - 1));
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      io.emit('player-left', { id: socket.id });
      io.emit('server-msg', { text: `${p.name} вышел` });
      slog('leave', `${p.name} (${players.size} online)`);
      checkRoundWin();
    }
  });
});

function pub(p) {
  return {
    id: p.id, name: p.name, team: p.team, pos: p.pos, yaw: p.yaw, pitch: p.pitch,
    anim: p.anim, crouch: p.crouch, weapon: p.weapon, alive: p.alive,
    kills: p.kills, deaths: p.deaths, skin: p.skin,
    prot: now() < p.protectedUntil,
  };
}

// 15Hz snapshots
setInterval(() => {
  if (!players.size) return;
  io.to('game').emit('snapshot', { t: now(), p: [...players.values()].map(pub) });
}, 1000 / 15);

// ---------- boot ----------
(async () => {
  // config.js is ESM but package.json is CJS — copy to .mjs so node imports it correctly
  const os = require('os');
  const cfgTmp = path.join(os.tmpdir(), `strike-config-${process.pid}.mjs`);
  fs.copyFileSync(path.join(__dirname, 'public', 'js', 'config.js'), cfgTmp);
  CFG = await import(pathToFileURL(cfgTmp).href);
  server.listen(PORT, () => {
    slog('boot', `STRIKE ARENA v2 on :${PORT} | map ${mapId} | admin pass ${process.env.ADMIN_PASS ? 'from env' : ADMIN_PASS}`);
  });
})();
