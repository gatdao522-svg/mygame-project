/**
 * STRIKE ARENA — multiplayer FPS server
 * Express static host + Socket.IO realtime sync.
 * Authoritative for: health, damage, kills/deaths, respawns, scoreboard.
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ---------- Game constants (must match client) ----------
const WEAPONS = {
  ak47:   { dmg: 30, headMul: 3.0, range: 300, rpm: 600 },
  pistol: { dmg: 26, headMul: 3.0, range: 200, rpm: 400 },
  awp:    { dmg: 110, headMul: 2.0, range: 500, rpm: 50 },
  knife:  { dmg: 55, headMul: 1.0, range: 2.2, rpm: 120 },
};
const MAX_HP = 100;
const RESPAWN_MS = 3500;
const SPAWNS = {
  t:  [[-34, 0, 26], [-30, 0, 30], [-26, 0, 26], [-30, 0, 22], [-36, 0, 30]],
  ct: [[34, 0, -26], [30, 0, -30], [26, 0, -26], [30, 0, -22], [36, 0, -30]],
};

// ---------- State ----------
const players = new Map(); // id -> player

function spawnPoint(team) {
  const list = SPAWNS[team] || SPAWNS.t;
  return list[Math.floor(Math.random() * list.length)].slice();
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, team: p.team, hp: p.hp,
    kills: p.kills, deaths: p.deaths, weapon: p.weapon,
    pos: p.pos, yaw: p.yaw, pitch: p.pitch, anim: p.anim, crouch: p.crouch,
    alive: p.alive,
  };
}

function teamCounts() {
  let t = 0, ct = 0;
  for (const p of players.values()) { if (p.team === 't') t++; else ct++; }
  return { t, ct };
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const name = String((data && data.name) || 'Player').slice(0, 16).trim() || 'Player';
    let team = data && data.team;
    if (team !== 't' && team !== 'ct') {
      const c = teamCounts();
      team = c.t <= c.ct ? 't' : 'ct';
    }
    const pos = spawnPoint(team);
    const p = {
      id: socket.id, name, team,
      hp: MAX_HP, kills: 0, deaths: 0,
      weapon: 'ak47', pos, yaw: 0, pitch: 0, anim: 'idle', crouch: false,
      alive: true, lastShot: 0,
    };
    players.set(socket.id, p);

    socket.emit('init', {
      id: socket.id,
      team,
      pos,
      players: [...players.values()].map(publicPlayer),
    });
    socket.broadcast.emit('player-joined', publicPlayer(p));
    io.emit('feed', { type: 'join', name, team });
  });

  // Movement/orientation updates (~15Hz from each client)
  socket.on('state', (s) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !s) return;
    if (Array.isArray(s.pos) && s.pos.length === 3 && s.pos.every(Number.isFinite)) {
      // sanity clamp to map bounds
      p.pos = [
        Math.max(-60, Math.min(60, s.pos[0])),
        Math.max(-5, Math.min(30, s.pos[1])),
        Math.max(-60, Math.min(60, s.pos[2])),
      ];
    }
    if (Number.isFinite(s.yaw)) p.yaw = s.yaw;
    if (Number.isFinite(s.pitch)) p.pitch = s.pitch;
    if (typeof s.anim === 'string') p.anim = s.anim.slice(0, 12);
    p.crouch = !!s.crouch;
    if (typeof s.weapon === 'string' && WEAPONS[s.weapon]) p.weapon = s.weapon;
  });

  // Shot fired — relay for tracers/sound/muzzle flash on other clients
  socket.on('shoot', (s) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    socket.broadcast.emit('shoot', {
      id: socket.id,
      weapon: p.weapon,
      origin: s && s.origin,
      dir: s && s.dir,
    });
  });

  // Hit claim from shooter client → validate & apply
  socket.on('hit', (h) => {
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.alive || !h) return;
    const target = players.get(h.targetId);
    if (!target || !target.alive) return;
    if (target.team === shooter.team) return; // no friendly fire
    const w = WEAPONS[shooter.weapon] || WEAPONS.ak47;

    // basic rate limiting: max plausible fire rate +25% slack
    const now = Date.now();
    const minInterval = (60000 / w.rpm) * 0.75;
    if (now - shooter.lastShot < minInterval) return;
    shooter.lastShot = now;

    // range check
    const dx = shooter.pos[0] - target.pos[0];
    const dy = shooter.pos[1] - target.pos[1];
    const dz = shooter.pos[2] - target.pos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > w.range * 1.15) return;

    const headshot = !!h.head;
    let dmg = Math.round(w.dmg * (headshot ? w.headMul : 1));
    // light distance falloff for bullets
    if (shooter.weapon !== 'knife' && shooter.weapon !== 'awp') {
      dmg = Math.round(dmg * Math.max(0.6, 1 - dist / (w.range * 2)));
    }

    target.hp = Math.max(0, target.hp - dmg);
    io.to(target.id).emit('damaged', { from: socket.id, dmg, hp: target.hp, dir: [dx, dz] });
    io.to(shooter.id).emit('hit-confirm', { targetId: target.id, dmg, headshot, killed: target.hp <= 0 });

    if (target.hp <= 0) {
      target.alive = false;
      target.deaths++;
      shooter.kills++;
      io.emit('kill', {
        killerId: shooter.id, killerName: shooter.name, killerTeam: shooter.team,
        victimId: target.id, victimName: target.name, victimTeam: target.team,
        weapon: shooter.weapon, headshot,
      });
      setTimeout(() => {
        if (!players.has(target.id)) return;
        target.hp = MAX_HP;
        target.alive = true;
        target.pos = spawnPoint(target.team);
        io.to(target.id).emit('respawn', { pos: target.pos, hp: MAX_HP });
        io.emit('player-respawned', { id: target.id, pos: target.pos });
      }, RESPAWN_MS);
    }
  });

  socket.on('chat', (msg) => {
    const p = players.get(socket.id);
    if (!p) return;
    const text = String(msg || '').slice(0, 120).trim();
    if (!text) return;
    io.emit('chat', { name: p.name, team: p.team, text });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      io.emit('player-left', { id: socket.id, name: p.name });
    }
  });
});

// Snapshot broadcast 15Hz
setInterval(() => {
  if (players.size === 0) return;
  const snap = [...players.values()].map((p) => ({
    id: p.id, pos: p.pos, yaw: p.yaw, pitch: p.pitch,
    anim: p.anim, crouch: p.crouch, hp: p.hp, weapon: p.weapon, alive: p.alive,
    kills: p.kills, deaths: p.deaths,
  }));
  io.emit('snapshot', snap);
}, 66);

server.listen(PORT, () => console.log(`STRIKE ARENA server on :${PORT}`));
