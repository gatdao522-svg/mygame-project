// ===== Remote players: animated characters, hitboxes, name tags, interpolation =====
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { assets } from './assets.js';
import { TEAM_INFO, INTERP_DELAY_MS, WEAPONS } from './config.js';
import { applySkin } from './weapons.js';

// per-model yaw so the muzzle points forward (models have different native axes)
const TP_YAW = { ak: -Math.PI / 2, pistol: Math.PI / 2, sniper: 0, knife: 0, m4: Math.PI / 2, mp5: Math.PI / 2, shotgun: Math.PI / 2, deagle: Math.PI / 2 };

function makeNameSprite(name, team) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(name, 128, 28);
  ctx.fillStyle = team === 't' ? '#e8a33d' : '#5ba2e8';
  ctx.fillText(name, 128, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.6, 0.35, 1);
  return s;
}

class Avatar {
  constructor(scene, info) {
    this.scene = scene;
    this.id = info.id;
    this.team = info.team;
    this.name = info.name;
    this.skin = info.skin || 'default';
    this.group = new THREE.Group();
    this.alive = info.alive !== false;
    this.deathT = 0;

    const charData = assets.chars[info.team] || assets.chars.t;
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;

    if (charData) {
      this.model = skeletonClone(charData.scene);
      const box = new THREE.Box3().setFromObject(this.model);
      const h = box.max.y - box.min.y || 1.8;
      const s = 1.8 / h;
      this.model.scale.setScalar(s);
      this.model.position.y = -box.min.y * s;
      this.group.add(this.model);
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of charData.clips) {
        this.actions[clip.name] = this.mixer.clipAction(clip);
      }
      this._attachGun();
    } else {
      const mat = new THREE.MeshLambertMaterial({ color: TEAM_INFO[info.team]?.color || 0x888888 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), mat);
      body.position.y = 0.9; body.castShadow = true;
      this.group.add(body);
    }

    // hitboxes (invisible, raycast targets) — CS-style: head / torso / legs
    const hbMat = new THREE.MeshBasicMaterial({ visible: false });
    this.headHB = new THREE.Mesh(new THREE.SphereGeometry(0.21, 8, 6), hbMat);
    this.headHB.userData = { playerId: this.id, zone: 'head' };
    this.bodyHB = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1, 0.5), hbMat);
    this.bodyHB.userData = { playerId: this.id, zone: 'body' };
    this.legsHB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.45), hbMat);
    this.legsHB.userData = { playerId: this.id, zone: 'legs' };
    this.group.add(this.headHB, this.bodyHB, this.legsHB);
    this._poseHitboxes(false);

    this.nameTag = makeNameSprite(info.name, info.team);
    this.nameTag.position.y = 2.1;
    this.group.add(this.nameTag);

    // spawn protection bubble
    this.protMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 16, 10),
      new THREE.MeshBasicMaterial({
        color: info.team === 't' ? 0xe8a33d : 0x5ba2e8,
        transparent: true, opacity: 0.16, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.protMesh.position.y = 1.0;
    this.protMesh.scale.y = 1.25;
    this.protMesh.visible = false;
    this.group.add(this.protMesh);

    if (Array.isArray(info.pos)) this.group.position.set(...info.pos);
    this.snaps = [];
    this.anim = 'idle';
    this.crouch = false;
    this.prot = !!info.prot;
    this.weapon = info.weapon || 'pistol';
    scene.add(this.group);
    this._play('Idle');
  }

  _attachGun() {
    let hand = null;
    this.model.traverse((o) => {
      if (!hand && o.isBone && /hand.*r$|r.*hand|fist.*r|arm.*r$/i.test(o.name)) hand = o;
    });
    this.gunHolder = new THREE.Group();
    if (hand) {
      hand.add(this.gunHolder);
      this.gunHolder.position.set(0, 0.12, 0.03);
      this.gunHolder.rotation.set(Math.PI / 2, 0, 0);
    } else {
      this.gunHolder.position.set(0.25, 1.25, 0.25);
      this.group.add(this.gunHolder);
    }
    this._setGunModel(this.weapon || 'pistol');
  }

  _setGunModel(weaponId) {
    if (!this.gunHolder) return;
    if (this.gunMesh) this.gunHolder.remove(this.gunMesh);
    const key = (WEAPONS[weaponId] || WEAPONS.pistol).model;
    const tpl = assets.guns[key];
    if (!tpl) return;
    this.gunMesh = tpl.clone();
    this.gunMesh.scale.setScalar(0.55);
    this.gunMesh.rotation.y = TP_YAW[key] ?? 0;
    applySkin(this.gunMesh, this.skin);
    this.gunHolder.add(this.gunMesh);
  }

  _poseHitboxes(crouch) {
    // must stay in sync with server bodyPoints(): head 1.66/1.11, chest 1.2/0.78
    const h = crouch ? 1.25 : 1.8;
    this.headHB.position.set(0, crouch ? 1.11 : 1.66, 0);
    // torso: from hip (~0.45h) to neck
    const torsoTop = h - 0.32, torsoBot = h * 0.42;
    this.bodyHB.scale.y = torsoTop - torsoBot;
    this.bodyHB.position.set(0, (torsoTop + torsoBot) / 2, 0);
    // legs: ground to hip
    this.legsHB.scale.y = torsoBot;
    this.legsHB.position.set(0, torsoBot / 2, 0);
  }

  _play(name, fade = 0.18, once = false) {
    const action = this.actions[name];
    if (!action || this.currentAction === action) return;
    action.reset();
    if (once) { action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; }
    action.fadeIn(fade).play();
    if (this.currentAction) this.currentAction.fadeOut(fade);
    this.currentAction = action;
  }

  pushSnap(s, now) {
    this.snaps.push({ t: now, pos: s.pos.slice(), yaw: s.yaw, pitch: s.pitch });
    if (this.snaps.length > 30) this.snaps.shift();
    if (s.weapon && s.weapon !== this.weapon) { this.weapon = s.weapon; this._setGunModel(s.weapon); }
    if (s.skin && s.skin !== this.skin) { this.skin = s.skin; this._setGunModel(this.weapon); }
    this.anim = s.anim; this.crouch = s.crouch;
    this.prot = !!s.prot;
    if (s.alive === false && this.alive) this.die();
    if (s.alive !== false && !this.alive) this.respawn(s.pos);
  }

  die() {
    this.alive = false;
    this._play('Death', 0.1, true);
    this.headHB.userData.playerId = null;
    this.bodyHB.userData.playerId = null;
    this.legsHB.userData.playerId = null;
    this.protMesh.visible = false;
  }

  respawn(pos) {
    this.alive = true;
    this.snaps.length = 0;
    if (Array.isArray(pos)) this.group.position.set(pos[0], pos[1], pos[2]);
    this.headHB.userData.playerId = this.id;
    this.bodyHB.userData.playerId = this.id;
    this.legsHB.userData.playerId = this.id;
    this._play('Idle', 0.05);
  }

  update(dt, now, camPos) {
    // animation LOD: distant avatars update their mixers less often (the
    // accumulated dt keeps playback speed correct) — big CPU win with many players
    if (this.mixer) {
      this._animDt = (this._animDt || 0) + dt;
      this._animTick = (this._animTick || 0) + 1;
      const d2 = camPos ? this.group.position.distanceToSquared(camPos) : 0;
      const every = d2 > 2500 ? 4 : d2 > 900 ? 2 : 1; // >50m: 1/4 rate, >30m: 1/2
      if (this._animTick % every === 0) { this.mixer.update(this._animDt); this._animDt = 0; }
    }
    if (!this.alive) return;

    const renderT = now - INTERP_DELAY_MS;
    const sn = this.snaps;
    if (sn.length >= 2) {
      let i = sn.length - 1;
      while (i > 0 && sn[i - 1].t > renderT) i--;
      const a = sn[Math.max(0, i - 1)], b = sn[i];
      const span = Math.max(1, b.t - a.t);
      const k = Math.min(1.5, Math.max(0, (renderT - a.t) / span));
      this.group.position.set(
        a.pos[0] + (b.pos[0] - a.pos[0]) * k,
        a.pos[1] + (b.pos[1] - a.pos[1]) * k,
        a.pos[2] + (b.pos[2] - a.pos[2]) * k,
      );
      let dy = b.yaw - a.yaw;
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      this.group.rotation.y = a.yaw + dy * k + Math.PI;
    } else if (sn.length === 1) {
      this.group.position.set(...sn[0].pos);
      this.group.rotation.y = sn[0].yaw + Math.PI;
    }

    this._poseHitboxes(this.crouch);
    this.protMesh.visible = this.prot;
    if (this.prot) this.protMesh.rotation.y += dt * 1.5;
    const animMap = { idle: 'Idle', walk: 'Walk', run: 'Run_Gun', air: 'Jump_Idle', crouch: 'Duck', shoot: 'Idle_Shoot' };
    let target = animMap[this.anim] || 'Idle';
    if (!this.actions[target]) target = this.actions['Run'] && this.anim === 'run' ? 'Run' : 'Idle';
    this._play(target);
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }
  addOrUpdateInfo(info) {
    if (this.map.has(info.id)) return this.map.get(info.id);
    const a = new Avatar(this.scene, info);
    this.map.set(info.id, a);
    return a;
  }
  remove(id) {
    const a = this.map.get(id);
    if (a) { a.dispose(); this.map.delete(id); }
  }
  applySnapshot(list, now, myId) {
    for (const s of list) {
      if (s.id === myId) continue;
      const a = this.map.get(s.id);
      if (a) a.pushSnap(s, now);
      else this.addOrUpdateInfo(s);
    }
  }
  hitboxes() {
    const out = [];
    for (const a of this.map.values()) {
      if (a.alive) { out.push(a.headHB, a.bodyHB, a.legsHB); }
    }
    return out;
  }
  update(dt, now, camPos) {
    for (const a of this.map.values()) a.update(dt, now, camPos);
  }
}
