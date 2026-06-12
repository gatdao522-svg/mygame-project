// ===== STRIKE ARENA v2 — main entry =====
import * as THREE from 'three';
import { buildMap } from './map.js';
import { loadAssets } from './assets.js';
import { WeaponSystem } from './weapons.js';
import { RemotePlayers } from './remotes.js';
import { Network } from './network.js';
import { UI } from './ui.js';
import { WEAPONS, PLAYER, SKINS } from './config.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- renderer / scenes ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;

const scene = new THREE.Scene();
const BASE_FOV = 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.08, 800);

const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xffffff, 0x665c44, 1.1));
const vmSun = new THREE.DirectionalLight(0xfff2d8, 1.2);
vmSun.position.set(1, 2, 0.5);
vmScene.add(vmSun);

addEventListener('resize', () => {
  camera.aspect = vmCamera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); vmCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- world (built after init tells us the map) ----------
let MAPS = null;
let world = null; // { colliders, raycastMeshes, mapData }

// ---------- player state ----------
const player = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  yaw: Math.PI * 0.75, pitch: 0,
  onGround: false, crouch: false, walk: false,
  hp: 100, dead: false, team: 't',
  joined: false,
  protectedUntil: 0,
};
const keys = {};
let mouseDown = false;
let sensitivity = 1.0;
let serverOffset = 0; // serverNow - Date.now()
const round = { phase: 'warmup', endsAt: 0, roundNo: 0, score: { t: 0, ct: 0 }, buyUntil: 0, mode: 'comp' };
let timeWarned = false;
let selectedSkin = localStorage.getItem('skin') || 'default';

// ---------- modules ----------
const effects = new (await import('./effects.js')).Effects(scene);
const remotes = new RemotePlayers(scene);
const net = new Network();
const ui = new UI();
let weapons = null;
let lastSnapshot = [];

function serverNow() { return Date.now() + serverOffset; }
function phaseLocked() { return round.phase === 'freeze' || round.phase === 'matchend'; }

// ---------- collision ----------
const pBox = new THREE.Box3();
function playerBox(pos, h) {
  const r = PLAYER.radius;
  pBox.min.set(pos.x - r, pos.y, pos.z - r);
  pBox.max.set(pos.x + r, pos.y + h, pos.z + r);
  return pBox;
}
function collides(pos, h) {
  if (!world) return null;
  const b = playerBox(pos, h);
  for (const c of world.colliders) {
    if (b.intersectsBox(c) && c.max.y > pos.y + 0.001 && c.min.y < pos.y + h) return c;
  }
  return null;
}
function moveAxis(pos, h, axis, delta) {
  if (delta === 0) return 0;
  pos[axis] += delta;
  const hit = collides(pos, h);
  if (!hit) return delta;
  if (axis !== 'y' && player.onGround) {
    const stepH = hit.max.y - pos.y;
    if (stepH > 0 && stepH <= PLAYER.stepUp) {
      const oldY = pos.y;
      pos.y = hit.max.y + 0.001;
      if (!collides(pos, h)) return delta;
      pos.y = oldY;
    }
  }
  pos[axis] -= delta;
  let step = delta / 8, moved = 0;
  for (let i = 0; i < 8; i++) {
    pos[axis] += step;
    if (collides(pos, h)) { pos[axis] -= step; break; }
    moved += step;
  }
  return moved;
}

// ---------- input: keyboard / mouse ----------
let chatOpen = false;
document.addEventListener('keydown', (e) => {
  if (chatOpen) {
    if (e.code === 'Enter') sendChat();
    if (e.code === 'Escape') closeChat();
    return;
  }
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); ui.showScoreboard(true); ui.updateScoreboard(lastSnapshotFull(), net.id); }
  if (e.code === 'KeyR' && weapons) weapons.startReload();
  if (e.code === 'KeyB' && player.joined) toggleBuyMenu();
  if (e.code === 'KeyF' && player.joined && !player.dead && round.mode === 'rust') {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const px = player.pos.x + fx * 2.4, pz = player.pos.z + fz * 2.4;
    net.sendPlaceBlock(+px.toFixed(2), +pz.toFixed(2), Math.abs(fz) >= Math.abs(fx));
  }
  if (e.code === 'Escape' && ui.isBuyOpen()) toggleBuyMenu(false);
  if (e.code === 'Enter' && player.joined) openChat();
  const slotKey = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 3 }[e.code];
  if (slotKey && weapons) weapons.switchTo(weapons.ownedWeaponForKey(slotKey));
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') ui.showScoreboard(false);
});
document.addEventListener('mousedown', (e) => {
  if (!isLocked() || !weapons || chatOpen) return;
  if (e.button === 0) { mouseDown = true; weapons.pullTrigger(true); }
  if (e.button === 2) weapons.trySetScope(!weapons.scoped);
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseDown = false; weapons && weapons.pullTrigger(false); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (!isLocked() || player.dead) return;
  const zoomMul = weapons && weapons.isScoped() ? 0.35 : 1;
  player.yaw -= e.movementX * 0.0022 * sensitivity * zoomMul;
  player.pitch -= e.movementY * 0.0022 * sensitivity * zoomMul;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});

function isLocked() { return IS_TOUCH || document.pointerLockElement === canvas; }

// --- pointer lock with pause overlay + cooldown handling ---
// Browsers reject requestPointerLock() for ~1.3s after Esc-exit and after
// tab switches the user gesture is gone — so we show a "click to resume"
// overlay and retry on failure instead of silently doing nothing.
let lockRetryT = null;
function showResume(show) {
  $('resume').classList.toggle('hidden', !show);
  if (!show) $('resume-note').classList.add('hidden');
}
function lockPointer() {
  if (IS_TOUCH) return;
  clearTimeout(lockRetryT);
  let p;
  try { p = canvas.requestPointerLock(); } catch { p = null; }
  if (p && p.catch) {
    p.then(() => showResume(false)).catch(() => {
      // cooldown after Esc — auto-retry while the user gesture is still "fresh"
      $('resume-note').classList.remove('hidden');
      lockRetryT = setTimeout(() => { try { canvas.requestPointerLock(); } catch {} }, 1350);
    });
  }
}
document.addEventListener('pointerlockchange', () => {
  if (IS_TOUCH) return;
  if (document.pointerLockElement === canvas) { showResume(false); return; }
  if (player.joined && !chatOpen && !ui.isBuyOpen()) showResume(true);
});
// any click while paused (or on the bare canvas) re-captures the mouse
$('resume').addEventListener('click', (e) => {
  if (e.target.id === 'resume-menu-btn') return;
  lockPointer();
});
$('resume-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  showResume(false);
  $('menu').classList.remove('hidden');
});
canvas.addEventListener('click', () => {
  const menuHidden = $('menu').classList.contains('hidden');
  if (player.joined && !isLocked() && !chatOpen && !ui.isBuyOpen() && menuHidden) lockPointer();
});
// returning to the tab: prompt to resume
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && player.joined && !isLocked() && !IS_TOUCH && !chatOpen && !ui.isBuyOpen() && $('menu').classList.contains('hidden')) {
    showResume(true);
  }
});

// ---------- buy menu ----------
ui.initBuyMenu((wid) => net.sendBuy(wid));
function buyAllowed() {
  if (round.mode === 'zombie' && player.team === 't' && round.phase !== 'warmup') return false;
  if (round.mode === 'dm') return true;
  return round.phase === 'warmup' || round.phase === 'freeze' ||
    (round.phase === 'live' && serverNow() < round.buyUntil);
}
function toggleBuyMenu(force) {
  const open = force !== undefined ? force : !ui.isBuyOpen();
  if (open && !buyAllowed()) { ui.centerMsg('Магазин закрыт', 1200); return; }
  ui.setBuyFree(round.phase === 'warmup');
  ui.showBuyMenu(open);
  $('buy-money').textContent = `$${ui.money}`;
  if (open) { if (!IS_TOUCH) document.exitPointerLock(); }
  else lockPointer();
}

// ---------- chat ----------
function openChat() {
  chatOpen = true;
  $('chat-input-wrap').classList.remove('hidden');
  $('chat-input').focus();
}
function closeChat() {
  chatOpen = false;
  $('chat-input').value = '';
  $('chat-input-wrap').classList.add('hidden');
  lockPointer();
}
function sendChat() {
  const txt = $('chat-input').value.trim();
  if (txt) net.sendChat(txt);
  closeChat();
}

// ---------- menu ----------
let selectedTeam = 'auto';
for (const btn of document.querySelectorAll('.team-btn')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.team-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedTeam = btn.dataset.team;
  });
}
$('sens').addEventListener('input', (e) => {
  sensitivity = parseFloat(e.target.value);
  $('sensVal').textContent = sensitivity.toFixed(1);
});
$('nick').value = localStorage.getItem('nick') || '';

// skin picker
{
  const wrap = $('skin-select');
  for (const [id, s] of Object.entries(SKINS)) {
    const b = document.createElement('button');
    b.className = 'skin-btn' + (id === selectedSkin ? ' selected' : '');
    b.title = s.name;
    b.style.background = s.tint
      ? `linear-gradient(135deg, #${s.tint.toString(16).padStart(6, '0')}, #222)`
      : 'linear-gradient(135deg, #555, #222)';
    b.addEventListener('click', () => {
      selectedSkin = id;
      localStorage.setItem('skin', id);
      document.querySelectorAll('.skin-btn').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      if (player.joined) net.sendSkin(id);
      if (weapons) weapons.refreshAppearance();
    });
    wrap.appendChild(b);
  }
}

$('play').disabled = true;
let assetsReady = false, mapsReady = false;
function maybeEnablePlay() {
  if (assetsReady && mapsReady) { $('play').disabled = false; $('loadStatus').textContent = 'Готово! Жми ИГРАТЬ'; }
}
fetch('maps.json').then((r) => r.json()).then((m) => { MAPS = m; mapsReady = true; maybeEnablePlay(); });
loadAssets((label, k) => {
  if (k < 1) $('loadStatus').textContent = `Загрузка: ${label}…`;
  else { assetsReady = true; maybeEnablePlay(); }
});

$('play').addEventListener('click', () => {
  audio.initAudio(); audio.resumeAudio();
  const name = $('nick').value.trim() || `Игрок${Math.floor(Math.random() * 99)}`;
  localStorage.setItem('nick', name);
  if (!weapons) {
    weapons = new WeaponSystem(vmScene, {
      camera, effects,
      raycastTargets: () => [...(world ? world.raycastMeshes : []), ...remotes.hitboxes()],
      onShoot: (p) => net.sendShoot(p),
      onReload: () => net.sendReload(),
      onHarvest: (id) => net.sendHarvest(id),
      onBlockHit: (id) => net.sendDamageBlock(id),
      ui,
      team: () => player.team,
      skin: () => selectedSkin,
    });
  }
  if (!player.joined) {
    net.join(name, selectedTeam === 'auto' ? null : selectedTeam, selectedSkin);
  }
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (IS_TOUCH) $('mobile-ui').classList.remove('hidden');
  lockPointer();
});

// ---------- network handlers ----------
net.on('init', (d) => {
  net.id = d.id;
  if (!world) {
    world = buildMap(scene, MAPS[d.map] || MAPS.arena);
    ui.initMinimap(world.mapData);
  }
  applyRustState(d.rust);
  player.joined = true;
  applyRound(d.round);
  for (const p of d.players) if (p.id !== d.id) remotes.addOrUpdateInfo(p);
  applyYou(d.you);
  const me = d.players.find((p) => p.id === d.id);
  if (me) player.team = me.team;
  if (weapons) weapons.refreshAppearance();
  ui.centerMsg(player.team === 't' ? 'Ты в команде БОЕВИКОВ' : 'Ты в команде СПЕЦНАЗА');
  if (!d.you.alive) ui.showDeath(null, true);
});

function applyYou(you) {
  if (!you) return;
  if (Array.isArray(you.pos)) {
    player.pos.set(you.pos[0], you.pos[1], you.pos[2]);
    player.vel.set(0, 0, 0);
  }
  player.hp = you.hp;
  ui.setHP(you.hp);
  if (you.alive && player.dead) { player.dead = false; ui.hideDeath(); }
  player.dead = !you.alive;
  player.protectedUntil = you.protectedUntil || 0;
  ui.setMoney(you.money);
  ui.setRes(you.res);
  if (weapons) weapons.syncFromServer(you);
}

function applyRustState(st) {
  if (!st || !world) return;
  for (const id of st.deadResources) world.setResourceAlive(id, false);
  for (const b of st.blocks) world.addBlock(b);
}
net.on('you', applyYou);

function applyRound(r) {
  const prevPhase = round.phase;
  const prevMode = round.mode;
  Object.assign(round, r);
  ui.setRoundScore(r.score.t, r.score.ct, r.roundNo, r.phase, r.mode);
  if (r.mode !== prevMode) ui.setTeamLabels(r.mode);
  ui.showResHud(r.mode === 'rust');
  timeWarned = false;
  if (r.phase === prevPhase) return;
  const zm = r.mode === 'zombie';
  if (r.phase === 'freeze') {
    weapons && (weapons.locked = true);
    ui.hideDeath();
    ui.banner(`РАУНД ${r.roundNo}`, zm ? 'Закупка — B. Зомби появятся среди вас…' : 'Закупка — B', 2400);
    audio.playFreezeBeep();
    if (!IS_TOUCH && player.joined && !player.dead) toggleBuyMenu(true);
  } else if (r.phase === 'live') {
    weapons && (weapons.locked = false);
    if (ui.isBuyOpen()) toggleBuyMenu(false);
    if (r.mode === 'dm') ui.banner('DEATHMATCH', `До ${50} убийств. Возрождение автоматическое`, 2500);
    else if (r.mode === 'rust') ui.banner('РАСТ', 'Добывай деревья и камни ножом, строй стены (F)', 3500);
    else ui.banner(zm ? 'ЗАРАЖЕНИЕ!' : 'В БОЙ!', zm ? 'Продержись до конца раунда' : '', 1800);
    audio.playRoundStart();
  } else if (r.phase === 'end') {
    const win = r.winner === player.team;
    ui.banner(
      r.winner
        ? (zm ? (r.winner === 't' ? '🧟 ЗОМБИ ПОБЕДИЛИ' : '🛡 ЛЮДИ ВЫЖИЛИ') : (r.winner === 't' ? 'БОЕВИКИ ПОБЕДИЛИ' : 'СПЕЦНАЗ ПОБЕДИЛ'))
        : 'РАУНД ОКОНЧЕН',
      win ? `+$3250` : '', 3000);
    if (r.winner) (win ? audio.playRoundWin : audio.playRoundLose)();
  } else if (r.phase === 'matchend') {
    weapons && (weapons.locked = true);
    ui.banner('МАТЧ ОКОНЧЕН', `Счёт ${r.score.t}:${r.score.ct} — новый матч скоро`, 8000);
  } else if (r.phase === 'warmup') {
    weapons && (weapons.locked = false);
    ui.banner('РАЗМИНКА', 'Ждём игроков… Оружие бесплатно (B)', 3000);
  }
}
net.on('round', applyRound);

net.on('player-joined', (p) => { if (p.id !== net.id) remotes.addOrUpdateInfo(p); });
net.on('player-update', (p) => {
  if (p.id === net.id) { player.team = p.team; return; }
  remotes.remove(p.id); // team/skin changed -> rebuild avatar
  remotes.addOrUpdateInfo(p);
});
net.on('infected', () => {
  player.dead = false;
  ui.hideDeath();
  if (ui.isBuyOpen()) toggleBuyMenu(false);
  ui.banner('🧟 ТЫ ЗАРАЖЁН!', 'Кусай выживших (нож). Убитые тобой встают зомби', 3500);
});
net.on('player-left', (p) => remotes.remove(p.id));
net.on('snapshot', (d) => {
  lastSnapshot = d.p;
  serverOffset = d.t - Date.now();
  remotes.applySnapshot(d.p, performance.now(), net.id);
});
net.on('shot', (s) => {
  const a = remotes.map.get(s.id);
  if (!a) return;
  const pos = a.group.position;
  const dist = pos.distanceTo(player.pos);
  audio.playGunshot(s.weapon, Math.max(0.05, 1 - dist / 80));
  effects.muzzleFlash(pos.clone().add(new THREE.Vector3(0, 1.4, 0)), s.weapon === 'awp');
});
net.on('damaged', (d) => {
  player.hp = d.hp;
  ui.setHP(d.hp);
  audio.playDamaged();
  const a = remotes.map.get(d.by);
  let ang = null;
  if (a) {
    const dx = a.group.position.x - player.pos.x;
    const dz = a.group.position.z - player.pos.z;
    ang = Math.atan2(dx, -dz) - player.yaw;
  }
  ui.damageFlash(ang);
});
net.on('hit-confirm', (h) => {
  ui.hitmarker(h.zone === 'head');
  audio.playHitmarker(h.zone === 'head');
  if (h.hp <= 0) audio.playKillDing();
});
net.on('hit-protected', () => ui.centerMsg('🛡 Игрок под защитой спавна', 1000));
net.on('kill', (k) => {
  ui.addKill(k);
  if (k.killer === net.id) ui.centerMsg(k.headshot ? '☠ ХЕДШОТ!' : 'Убийство!', 1500);
});
net.on('died', (d) => {
  player.dead = true;
  ui.showDeath(d.by, d.waitRound);
  if (ui.isBuyOpen()) toggleBuyMenu(false);
});
net.on('respawned', (r) => {
  if (r.id !== net.id) return;
  player.pos.set(r.pos[0], r.pos[1], r.pos[2]);
  player.vel.set(0, 0, 0);
  player.dead = false;
  ui.hideDeath();
});
net.on('reward', (d) => ui.setMoney(d.money));
net.on('buy-ok', () => { audio.playBuy(); $('buy-money').textContent = `$${ui.money}`; });
net.on('buy-fail', (d) => { audio.playBuyFail(); ui.centerMsg(d.reason || 'Нельзя купить', 1400); });
net.on('correct', (d) => {
  player.pos.set(d.pos[0], d.pos[1], d.pos[2]);
  player.vel.set(0, 0, 0);
});
net.on('chat', (c) => ui.addChat(c.name, c.team, c.text));
net.on('server-msg', (m) => ui.addChat(null, null, m.text));
net.on('reloading', () => {});
net.on('resource-update', (d) => { if (world) world.setResourceAlive(d.id, d.alive); });
net.on('block-add', (b) => { if (world) world.addBlock(b); });
net.on('block-remove', (d) => { if (world) world.removeBlock(d.id); });
net.on('rust-reset', (st) => {
  if (!world) return;
  (world.mapData.resources || []).forEach((_, id) => world.setResourceAlive(id, true));
  applyRustState(st);
});
net.on('harvested', (d) => {
  ui.centerMsg(`+${d.amount} ${d.kind === 'wood' ? '🪵 дерево' : '🪨 камень'}`);
});
net.on('map-change', () => { ui.banner('СМЕНА КАРТЫ', 'Перезагрузка…', 0); setTimeout(() => location.reload(), 1200); });
net.on('join-fail', (d) => {
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('loadStatus').textContent = `⛔ ${d.reason || 'Не удалось подключиться'}`;
});
net.on('kicked', (d) => {
  document.exitPointerLock && document.exitPointerLock();
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('loadStatus').textContent = `⛔ ${d.reason || 'Кикнут с сервера'}`;
  $('play').disabled = true;
  net.socket.disconnect();
});

function lastSnapshotFull() {
  const out = [];
  for (const s of lastSnapshot) {
    const a = remotes.map.get(s.id);
    if (s.id === net.id) {
      out.push({ id: s.id, name: localStorage.getItem('nick') || 'Я', team: player.team, kills: s.kills, deaths: s.deaths });
    } else if (a) {
      out.push({ id: s.id, name: a.name, team: a.team, kills: s.kills, deaths: s.deaths });
    }
  }
  return out;
}

// ---------- mobile controls ----------
const mobile = { wishX: 0, wishZ: 0, lookId: null, lastLX: 0, lastLY: 0 };
if (IS_TOUCH) {
  const joy = $('joystick'), knob = $('joystick-knob');
  let joyId = null;
  const joyCenter = () => {
    const r = joy.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: r.width / 2 };
  };
  joy.addEventListener('touchstart', (e) => { joyId = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        const c = joyCenter();
        let dx = (t.clientX - c.x) / c.rad, dy = (t.clientY - c.y) / c.rad;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        mobile.wishX = dx; mobile.wishZ = dy;
        knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
      } else if (t.identifier === mobile.lookId) {
        player.yaw -= (t.clientX - mobile.lastLX) * 0.0042 * sensitivity;
        player.pitch -= (t.clientY - mobile.lastLY) * 0.0042 * sensitivity;
        player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
        mobile.lastLX = t.clientX; mobile.lastLY = t.clientY;
      }
    }
  }, { passive: true });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; mobile.wishX = mobile.wishZ = 0; knob.style.transform = ''; }
      if (t.identifier === mobile.lookId) mobile.lookId = null;
    }
  };
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (mobile.lookId === null) {
        mobile.lookId = t.identifier;
        mobile.lastLX = t.clientX; mobile.lastLY = t.clientY;
      }
    }
  }, { passive: true });

  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); down(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); up && up(); }, { passive: false });
  };
  hold('m-fire', () => weapons && weapons.pullTrigger(true), () => weapons && weapons.pullTrigger(false));
  hold('m-jump', () => { keys.Space = true; }, () => { keys.Space = false; });
  hold('m-reload', () => weapons && weapons.startReload());
  hold('m-buy', () => toggleBuyMenu());
  hold('m-weapon', () => {
    if (!weapons) return;
    const order = [weapons.loadout.primary, weapons.loadout.secondary, 'knife'].filter(Boolean);
    const idx = order.indexOf(weapons.current);
    weapons.switchTo(order[(idx + 1) % order.length]);
  });
}

// ---------- net send ----------
let netAcc = 0;
function netSend(dt, speed) {
  netAcc += dt;
  if (netAcc < 1 / 15 || !player.joined) return;
  netAcc = 0;
  let anim = 'idle';
  if (!player.onGround) anim = 'air';
  else if (player.crouch) anim = speed > 0.5 ? 'walk' : 'crouch';
  else if (speed > 4) anim = 'run';
  else if (speed > 0.5) anim = 'walk';
  if (mouseDown && weapons && weapons.ammo.mag > 0) anim = speed > 4 ? 'run' : 'shoot';
  net.sendState({
    pos: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)],
    yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3),
    anim, crouch: player.crouch,
    weapon: weapons ? weapons.current : 'pistol',
  });
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
let stepAcc = 0;
let smoothEye = PLAYER.eyeStand; // smoothed eye height (crouch transitions)
let landDip = 0;                 // camera dip after hard landings
let bobPhase = 0;                // run view-bob phase

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const nowMs = performance.now();

  player.crouch = !!keys.ControlLeft || !!keys.KeyC;
  player.walk = !!keys.ShiftLeft;
  const h = player.crouch ? PLAYER.heightCrouch : PLAYER.heightStand;
  const scopedMul = weapons && weapons.isScoped() ? PLAYER.scopedSpeedMul : 1;
  const maxSpeed = (player.crouch ? PLAYER.crouchSpeed : player.walk ? PLAYER.walkSpeed : PLAYER.runSpeed) * scopedMul;

  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(-fwd.z, 0, fwd.x);
  wish.set(0, 0, 0);
  const canMove = !player.dead && isLocked() && !chatOpen && !ui.isBuyOpen() && !phaseLocked() && world;
  if (canMove) {
    if (keys.KeyW) wish.add(fwd);
    if (keys.KeyS) wish.sub(fwd);
    if (keys.KeyA) wish.sub(right);
    if (keys.KeyD) wish.add(right);
    if (IS_TOUCH && (mobile.wishX || mobile.wishZ)) {
      wish.addScaledVector(fwd, -mobile.wishZ);
      wish.addScaledVector(right, mobile.wishX);
    }
  }
  if (wish.lengthSq() > 1) wish.normalize();

  if (player.onGround) {
    player.vel.x += wish.x * PLAYER.accelGround * dt;
    player.vel.z += wish.z * PLAYER.accelGround * dt;
    const f = Math.max(0, 1 - PLAYER.friction * dt);
    if (wish.lengthSq() === 0) { player.vel.x *= f; player.vel.z *= f; }
    const hs = Math.hypot(player.vel.x, player.vel.z);
    if (hs > maxSpeed) { const k = maxSpeed / hs; player.vel.x *= k; player.vel.z *= k; }
  } else {
    // CS/Quake-style air accel: only limit speed along the wish direction, so
    // momentum is preserved and air-strafing feels right instead of velocity
    // getting hard-clamped mid-jump.
    const cur = player.vel.x * wish.x + player.vel.z * wish.z;
    const add = Math.min(Math.max(0, maxSpeed * 0.9 - cur), PLAYER.accelAir * maxSpeed * dt);
    player.vel.x += wish.x * add;
    player.vel.z += wish.z * add;
  }
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);

  if (canMove && player.onGround && keys.Space) {
    player.vel.y = PLAYER.jumpVel;
    player.onGround = false;
  }
  player.vel.y -= PLAYER.gravity * dt;
  if (phaseLocked()) { player.vel.x = 0; player.vel.z = 0; }

  moveAxis(player.pos, h, 'x', player.vel.x * dt);
  moveAxis(player.pos, h, 'z', player.vel.z * dt);
  const fallSpeed = -player.vel.y;
  const dy = moveAxis(player.pos, h, 'y', player.vel.y * dt);
  if (player.vel.y < 0 && (dy > player.vel.y * dt + 1e-9 || dy === 0)) {
    if (!player.onGround && fallSpeed > 4.5) { // landing impact: camera dip + thud
      landDip = Math.min(0.16, (fallSpeed - 4.5) * 0.022);
      audio.playFootstep(Math.min(0.16, 0.06 + fallSpeed * 0.012));
    }
    player.onGround = true; player.vel.y = 0;
  } else if (player.vel.y > 0 && dy === 0) {
    player.vel.y = 0;
  } else if (dy < 0) {
    player.onGround = false;
  }
  if (player.pos.y < -3) { player.pos.set(0, 0, 0); player.vel.set(0, 0, 0); }

  if (player.onGround && hSpeed > 2 && !player.crouch && !player.walk) {
    stepAcc += dt * hSpeed;
    if (stepAcc > 3.4) { stepAcc = 0; audio.playFootstep(0.07); }
  }

  // --- camera ---
  // smooth crouch transition + landing dip + subtle run bob (CS feel)
  const targetEye = player.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
  smoothEye += (targetEye - smoothEye) * Math.min(1, dt * 14);
  landDip = Math.max(0, landDip - dt * 0.55);
  if (player.onGround && hSpeed > 1.5) bobPhase += dt * hSpeed * 1.8;
  const bobAmp = player.onGround ? Math.min(1, hSpeed / PLAYER.runSpeed) * 0.018 : 0;
  const bobY = Math.abs(Math.sin(bobPhase)) * bobAmp;
  const eyeH = smoothEye - landDip + bobY;
  const rc = weapons ? weapons.getRecoil() : { pitch: 0, yaw: 0 };
  camera.position.set(player.pos.x, player.pos.y + eyeH, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw + rc.yaw;
  camera.rotation.x = player.pitch + rc.pitch;

  const scoped = weapons && weapons.isScoped();
  const targetFov = scoped ? BASE_FOV / WEAPONS.awp.zoom : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  ui.setScope(!!scoped);

  // --- round timer HUD ---
  if (player.joined) {
    if (round.endsAt) {
      const left = round.endsAt - serverNow();
      const warn = round.phase === 'live' && left < 15000;
      ui.setRoundTimer(left, warn);
      if (round.phase === 'live' && left < 10000 && !timeWarned) { timeWarned = true; audio.playTimeWarning(); }
    } else ui.setRoundTimer(null);
    ui.setProtected(!player.dead && Date.now() + serverOffset < player.protectedUntil);
  }

  // --- systems ---
  if (weapons) {
    weapons.update(dt, {
      speed: hSpeed, onGround: player.onGround, dead: player.dead,
      moveFactor: Math.min(1, hSpeed / 6) + (player.onGround ? 0 : 0.6),
    });
    const spreadPx = weapons._spread(Math.min(1, hSpeed / 6)) * 4200;
    const hideCh = scoped || weapons.current === 'knife' || (weapons.cfg.zoom != null && !scoped);
    ui.setCrosshairGap(Math.min(spreadPx, 60), hideCh);
  }
  effects.update(dt);
  remotes.update(dt, nowMs, camera.position);
  netSend(dt, hSpeed);
  if (world) ui.drawMinimap({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }, remotes.map, player.team);
  ui.tickFPS(dt);

  // --- render ---
  renderer.clear();
  renderer.render(scene, camera);
  if (!scoped && !player.dead && weapons) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }

  adaptResolution(dt);
}

// ---------- adaptive resolution: keep frame rate up on weak GPUs ----------
const PR_MAX = Math.min(devicePixelRatio, IS_TOUCH ? 1.25 : 1.75);
const PR_MIN = Math.min(devicePixelRatio, 0.75);
let prCurrent = PR_MAX, fpsAcc = 0, fpsN = 0, fpsTimer = 0;
function adaptResolution(dt) {
  fpsAcc += dt; fpsN++; fpsTimer += dt;
  if (fpsTimer < 2) return; // evaluate every 2s
  const fps = fpsN / fpsAcc;
  fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  let next = prCurrent;
  if (fps < 45) next = Math.max(PR_MIN, prCurrent - 0.25);
  else if (fps > 58 && prCurrent < PR_MAX) next = Math.min(PR_MAX, prCurrent + 0.125);
  if (Math.abs(next - prCurrent) > 0.01) {
    prCurrent = next;
    renderer.setPixelRatio(prCurrent);
    renderer.setSize(innerWidth, innerHeight);
  }
}

// debug hooks
window.__dbg = () => ({
  remotes: [...remotes.map.values()].map((a) => ({ n: a.name, pos: a.group.position.toArray().map((v) => +v.toFixed(1)), alive: a.alive, hasModel: !!a.model })),
  me: { pos: player.pos.toArray().map((v) => +v.toFixed(1)), yaw: +player.yaw.toFixed(2), team: player.team, joined: player.joined, dead: player.dead, hp: player.hp },
  round: { ...round },
  money: ui.money,
});
window.__look = (yaw, pitch = 0) => { player.yaw = yaw; player.pitch = pitch; };
window.__w = () => weapons;
window.__net = () => net;
window.__scene = () => scene;
window.__camera = () => camera;
window.__three = THREE;

tick();
