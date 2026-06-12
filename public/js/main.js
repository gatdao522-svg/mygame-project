// ===== STRIKE ARENA — main entry =====
import * as THREE from 'three';
import { buildMap } from './map.js';
import { loadAssets } from './assets.js';
import { WeaponSystem } from './weapons.js';
import { RemotePlayers } from './remotes.js';
import { Network } from './network.js';
import { UI } from './ui.js';
import { WEAPONS, PLAYER } from './config.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------- renderer / scenes ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;

const scene = new THREE.Scene();
const BASE_FOV = 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.08, 500);

// viewmodel overlay scene
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

// ---------- world ----------
const { colliders, raycastMeshes, mapData } = buildMap(scene);
const ui = new UI();
ui.initMinimap(mapData);

// ---------- player state ----------
const player = {
  pos: new THREE.Vector3(-30, 0, 26), // feet
  vel: new THREE.Vector3(),
  yaw: Math.PI * 0.75, pitch: 0,
  onGround: false, crouch: false, walk: false,
  hp: 100, dead: false, team: 't',
  joined: false,
};
const keys = {};
let mouseDown = false, rightDown = false;
let sensitivity = 1.0;

// ---------- modules ----------
const effects = new (await import('./effects.js')).Effects(scene);
const remotes = new RemotePlayers(scene);
const net = new Network();
let weapons = null; // created after assets load

const scores = { t: 0, ct: 0 };
let lastSnapshot = [];

// ---------- collision ----------
const pBox = new THREE.Box3();
function playerBox(pos, h) {
  const r = PLAYER.radius;
  pBox.min.set(pos.x - r, pos.y, pos.z - r);
  pBox.max.set(pos.x + r, pos.y + h, pos.z + r);
  return pBox;
}
function collides(pos, h) {
  const b = playerBox(pos, h);
  for (const c of colliders) {
    if (b.intersectsBox(c) && c.max.y > pos.y + 0.001 && c.min.y < pos.y + h) return c;
  }
  return null;
}

function moveAxis(pos, h, axis, delta) {
  if (delta === 0) return 0;
  pos[axis] += delta;
  const hit = collides(pos, h);
  if (!hit) return delta;
  // try step-up for horizontal movement
  if (axis !== 'y' && player.onGround) {
    const stepH = hit.max.y - pos.y;
    if (stepH > 0 && stepH <= PLAYER.stepUp) {
      const oldY = pos.y;
      pos.y = hit.max.y + 0.001;
      if (!collides(pos, h)) return delta;
      pos.y = oldY;
    }
  }
  // binary-ish resolve: push back out
  pos[axis] -= delta;
  let step = delta / 8;
  let moved = 0;
  for (let i = 0; i < 8; i++) {
    pos[axis] += step;
    if (collides(pos, h)) { pos[axis] -= step; break; }
    moved += step;
  }
  return moved;
}

// ---------- input ----------
document.addEventListener('keydown', (e) => {
  if (chatOpen) {
    if (e.code === 'Enter') sendChat();
    if (e.code === 'Escape') closeChat();
    return;
  }
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); ui.showScoreboard(true); ui.updateScoreboard(lastSnapshotFull(), net.id); }
  if (e.code === 'KeyR' && weapons) weapons.startReload();
  if (e.code === 'Enter' && player.joined) openChat();
  const slot = { Digit1: 'ak47', Digit2: 'pistol', Digit3: 'awp', Digit4: 'knife' }[e.code];
  if (slot && weapons) { weapons.switchTo(slot); ui.setWeapon(WEAPONS[slot].name, weapons.inventory[slot]); }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') ui.showScoreboard(false);
});
document.addEventListener('mousedown', (e) => {
  if (!isLocked() || !weapons || chatOpen) return;
  if (e.button === 0) { mouseDown = true; weapons.pullTrigger(true); }
  if (e.button === 2) { rightDown = true; weapons.trySetScope(!weapons.scoped); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseDown = false; weapons && weapons.pullTrigger(false); }
  if (e.button === 2) rightDown = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (!isLocked() || player.dead) return;
  const zoomMul = weapons && weapons.isScoped() ? 0.35 : 1;
  player.yaw -= e.movementX * 0.0022 * sensitivity * zoomMul;
  player.pitch -= e.movementY * 0.0022 * sensitivity * zoomMul;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});

function isLocked() { return document.pointerLockElement === canvas; }
document.addEventListener('pointerlockchange', () => {
  if (!isLocked() && player.joined && !chatOpen) {
    $('menu').classList.remove('hidden');
  }
});

// ---------- chat ----------
let chatOpen = false;
function openChat() {
  chatOpen = true;
  $('chat-input-wrap').classList.remove('hidden');
  $('chat-input').focus();
}
function closeChat() {
  chatOpen = false;
  $('chat-input').value = '';
  $('chat-input-wrap').classList.add('hidden');
  canvas.requestPointerLock();
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

$('play').disabled = true;
loadAssets((label, k) => {
  $('loadStatus').textContent = k >= 1 ? 'Готово! Жми ИГРАТЬ' : `Загрузка: ${label}…`;
  if (k >= 1) $('play').disabled = false;
});

$('play').addEventListener('click', () => {
  audio.initAudio(); audio.resumeAudio();
  const name = $('nick').value.trim() || `Игрок${Math.floor(Math.random() * 99)}`;
  localStorage.setItem('nick', name);
  if (!weapons) {
    weapons = new WeaponSystem(vmScene, {
      camera, effects,
      raycastTargets: () => [...raycastMeshes, ...remotes.hitboxes()],
      onShoot: (p) => net.sendShoot(p),
      onHit: (p) => net.sendHit(p),
      ui,
    });
    ui.setWeapon(WEAPONS.ak47.name, weapons.inventory.ak47);
  }
  if (!player.joined) {
    net.join(name, selectedTeam === 'auto' ? null : selectedTeam);
  }
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  canvas.requestPointerLock();
});

// ---------- network handlers ----------
net.on('init', (d) => {
  net.id = d.id;
  player.team = d.team;
  player.pos.set(d.pos[0], d.pos[1], d.pos[2]);
  player.joined = true;
  player.hp = 100; player.dead = false;
  ui.setHP(100);
  for (const p of d.players) {
    if (p.id !== d.id) remotes.addOrUpdateInfo(p);
  }
  ui.centerMsg(d.team === 't' ? 'Ты в команде БОЕВИКОВ' : 'Ты в команде СПЕЦНАЗА');
});
net.on('player-joined', (p) => { if (p.id !== net.id) remotes.addOrUpdateInfo(p); });
net.on('player-left', (p) => remotes.remove(p.id));
net.on('snapshot', (list) => {
  lastSnapshot = list;
  remotes.applySnapshot(list, performance.now(), net.id);
});
net.on('shoot', (s) => {
  if (!s.origin || !s.dir) return;
  const from = new THREE.Vector3(...s.origin);
  const dir = new THREE.Vector3(...s.dir);
  const dist = from.distanceTo(player.pos);
  audio.playGunshot(s.weapon, Math.max(0.05, 1 - dist / 80));
  // tracer to approximate end
  const end = from.clone().addScaledVector(dir, 60);
  effects.tracer(from, end);
  effects.muzzleFlash(from, s.weapon === 'awp');
});
net.on('damaged', (d) => {
  player.hp = d.hp;
  ui.setHP(d.hp);
  audio.playDamaged();
  // direction indicator
  const a = remotes.map.get(d.from);
  let ang = null;
  if (a) {
    const dx = a.group.position.x - player.pos.x;
    const dz = a.group.position.z - player.pos.z;
    ang = Math.atan2(dx, -dz) - player.yaw;
  }
  ui.damageFlash(ang);
});
net.on('hit-confirm', (h) => {
  ui.hitmarker(h.headshot);
  audio.playHitmarker(h.headshot);
  if (h.killed) audio.playKillDing();
});
net.on('kill', (k) => {
  ui.addKill(k);
  scores[k.killerTeam]++;
  ui.setTeamScores(scores.t, scores.ct);
  if (k.victimId === net.id) {
    player.dead = true;
    ui.showDeath(k.killerName, 3.5);
  }
  if (k.killerId === net.id) {
    ui.centerMsg(k.headshot ? '☠ ХЕДШОТ!' : 'Убийство!', 1500);
  }
});
net.on('respawn', (r) => {
  player.pos.set(r.pos[0], r.pos[1], r.pos[2]);
  player.vel.set(0, 0, 0);
  player.hp = r.hp; player.dead = false;
  ui.setHP(r.hp);
  ui.hideDeath();
  if (weapons) {
    for (const id of Object.keys(WEAPONS)) {
      weapons.inventory[id].mag = WEAPONS[id].mag;
      weapons.inventory[id].reserve = WEAPONS[id].reserve;
    }
    ui.setAmmo(weapons.ammo);
  }
});
net.on('chat', (c) => ui.addChat(c.name, c.team, c.text));
net.on('feed', () => {});

function lastSnapshotFull() {
  // merge names/teams from remotes + self
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

// ---------- footsteps ----------
let stepAcc = 0;

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
    weapon: weapons ? weapons.current : 'ak47',
  });
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  // --- movement ---
  player.crouch = !!keys.ControlLeft || !!keys.KeyC;
  player.walk = !!keys.ShiftLeft;
  const h = player.crouch ? PLAYER.heightCrouch : PLAYER.heightStand;
  const scopedMul = weapons && weapons.isScoped() ? PLAYER.scopedSpeedMul : 1;
  const maxSpeed = (player.crouch ? PLAYER.crouchSpeed : player.walk ? PLAYER.walkSpeed : PLAYER.runSpeed) * scopedMul;

  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(-fwd.z, 0, fwd.x);
  wish.set(0, 0, 0);
  if (!player.dead && isLocked() && !chatOpen) {
    if (keys.KeyW) wish.add(fwd);
    if (keys.KeyS) wish.sub(fwd);
    if (keys.KeyA) wish.sub(right);
    if (keys.KeyD) wish.add(right);
  }
  wish.normalize();

  const accel = player.onGround ? PLAYER.accelGround : PLAYER.accelAir;
  player.vel.x += wish.x * accel * dt;
  player.vel.z += wish.z * accel * dt;
  if (player.onGround) {
    const f = Math.max(0, 1 - PLAYER.friction * dt);
    if (wish.lengthSq() === 0) { player.vel.x *= f; player.vel.z *= f; }
  }
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  if (hSpeed > maxSpeed) {
    const k = maxSpeed / hSpeed;
    player.vel.x *= k; player.vel.z *= k;
  }

  if (!player.dead && player.onGround && keys.Space && isLocked()) {
    player.vel.y = PLAYER.jumpVel;
    player.onGround = false;
  }
  player.vel.y -= PLAYER.gravity * dt;

  // integrate with collision
  moveAxis(player.pos, h, 'x', player.vel.x * dt);
  moveAxis(player.pos, h, 'z', player.vel.z * dt);
  const dy = moveAxis(player.pos, h, 'y', player.vel.y * dt);
  if (player.vel.y < 0 && dy > player.vel.y * dt + 1e-9) {
    player.onGround = true; player.vel.y = 0;
  } else if (player.vel.y < 0 && dy === 0) {
    player.onGround = true; player.vel.y = 0;
  } else if (player.vel.y > 0 && dy === 0) {
    player.vel.y = 0;
  } else if (dy < 0) {
    player.onGround = false;
  }
  if (player.pos.y < -3) { player.pos.set(0, 0, 0); player.vel.set(0, 0, 0); } // failsafe

  // footsteps
  if (player.onGround && hSpeed > 2 && !player.crouch && !player.walk) {
    stepAcc += dt * hSpeed;
    if (stepAcc > 3.4) { stepAcc = 0; audio.playFootstep(0.07); }
  }

  // --- camera ---
  const eyeH = player.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
  const rc = weapons ? weapons.getRecoil() : { pitch: 0, yaw: 0 };
  camera.position.set(player.pos.x, player.pos.y + eyeH, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw + rc.yaw;
  camera.rotation.x = player.pitch + rc.pitch;

  // scope FOV
  const scoped = weapons && weapons.isScoped();
  const targetFov = scoped ? BASE_FOV / WEAPONS.awp.zoom : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  ui.setScope(!!scoped);

  // --- systems ---
  if (weapons) {
    weapons.update(dt, {
      speed: hSpeed, onGround: player.onGround, dead: player.dead,
      moveFactor: Math.min(1, hSpeed / 6) + (player.onGround ? 0 : 0.6),
    });
    const spreadPx = weapons._spread(Math.min(1, hSpeed / 6)) * 4200;
    // hide crosshair while scoped, with knife, or with unscoped AWP (CS-style)
    const hideCh = scoped || weapons.current === 'knife' || (weapons.cfg.zoom != null && !scoped);
    ui.setCrosshairGap(Math.min(spreadPx, 60), hideCh);
  }
  effects.update(dt);
  remotes.update(dt, now);
  netSend(dt, hSpeed);
  ui.drawMinimap({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }, remotes.map, player.team);
  ui.tickFPS(dt);

  // --- render ---
  renderer.clear();
  renderer.render(scene, camera);
  if (!scoped && !player.dead && weapons) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
}
tick();

// debug hook
window.__dbg = () => ({
  remotes: [...remotes.map.values()].map((a) => ({ n: a.name, pos: a.group.position.toArray().map(v=>+v.toFixed(1)), alive: a.alive, hasModel: !!a.model, anims: Object.keys(a.actions).length })),
  me: { pos: player.pos.toArray().map(v=>+v.toFixed(1)), yaw: +player.yaw.toFixed(2), team: player.team, joined: player.joined },
  charsLoaded: Object.keys((window.__assets||{})),
});
import('./assets.js').then(m => { window.__assets = m.assets.chars; });
window.__look = (yaw, pitch=0) => { player.yaw = yaw; player.pitch = pitch; };
window.__w = () => weapons;
