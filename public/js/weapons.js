// ===== First-person weapon system: viewmodel + arms, recoil, spread, loadout =====
import * as THREE from 'three';
import { WEAPONS, SKINS } from './config.js';
import { assets } from './assets.js';
import { makeArms, poseForWeapon } from './arms.js';
import * as audio from './audio.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();

export function applySkin(root, skinId) {
  const s = SKINS[skinId];
  if (!s || !s.tint) return;
  root.traverse((o) => {
    if (o.isMesh && o.material && !o.userData.isArms) {
      o.material = o.material.clone();
      if (o.material.color) o.material.color.lerp(new THREE.Color(s.tint), 0.75);
      if ('metalness' in o.material) o.material.metalness = s.metal ?? o.material.metalness;
      if ('roughness' in o.material) o.material.roughness = s.rough ?? o.material.roughness;
      if (s.emissive && o.material.emissive) o.material.emissive.set(s.emissive);
    }
  });
}

export class WeaponSystem {
  /**
   * @param vmScene  separate overlay scene for the viewmodel
   * @param deps { camera, effects, raycastTargets(), onShoot(payload), onReload(), ui, team(), skin() }
   */
  constructor(vmScene, deps) {
    this.vmScene = vmScene;
    this.deps = deps;
    this.raycaster = new THREE.Raycaster();

    this.holder = new THREE.Group();
    vmScene.add(this.holder);

    // server-driven state
    this.loadout = { primary: null, secondary: 'pistol' };
    this.inventory = { pistol: { mag: 12, reserve: 48 }, knife: { mag: Infinity, reserve: Infinity } };
    this.current = 'pistol';

    this.vm = null;
    this.arms = null;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.shotIndex = 0;
    this.sprayResetT = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilTargetP = 0;
    this.recoilTargetY = 0;
    this.kick = 0;
    this.switchT = 1;
    this.bobT = 0;
    this.scoped = false;
    this.triggerHeld = false;
    this.locked = false; // freeze phase

    this._mountViewmodel();
  }

  get cfg() { return WEAPONS[this.current]; }
  get ammo() { return this.inventory[this.current] || { mag: 0, reserve: 0 }; }

  /** apply server 'you' payload */
  syncFromServer(you) {
    if (you.loadout) this.loadout = you.loadout;
    if (you.ammo) {
      for (const [wid, a] of Object.entries(you.ammo)) {
        this.inventory[wid] = {
          mag: a.mag < 0 ? Infinity : a.mag,
          reserve: a.reserve < 0 ? Infinity : a.reserve,
        };
      }
      // drop ammo entries for weapons no longer owned
      for (const wid of Object.keys(this.inventory)) {
        if (wid === 'knife') continue;
        if (this.loadout.primary !== wid && this.loadout.secondary !== wid) delete this.inventory[wid];
      }
    }
    if (you.weapon && you.weapon !== this.current && WEAPONS[you.weapon]) {
      this.current = you.weapon;
      this.reloading = false;
      this.switchT = 0;
      this._mountViewmodel();
    }
    this.deps.ui.setWeapon(this.cfg.name, this.ammo);
  }

  _mountViewmodel() {
    if (this.vm) this.holder.remove(this.vm);
    const cfg = this.cfg;
    const template = assets.guns[cfg.model];
    this.vm = template ? template.clone() : new THREE.Group();
    this.vm.scale.setScalar(cfg.vmScale);
    this.vm.rotation.set(...cfg.vmRot);
    applySkin(this.vm, this.deps.skin ? this.deps.skin() : 'default');
    this.holder.add(this.vm);
    // first-person arms — anchor hands to the actual gun model's grips
    if (this.arms) this.holder.remove(this.arms);
    const pose = poseForWeapon(cfg);
    let grips = null;
    try {
      this.holder.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(this.vm);
      if (!bb.isEmpty()) {
        bb.applyMatrix4(new THREE.Matrix4().copy(this.holder.matrixWorld).invert());
        const len = Math.max(0.001, bb.max.z - bb.min.z);
        const ht = Math.max(0.001, bb.max.y - bb.min.y);
        const midX = (bb.min.x + bb.max.x) / 2;
        if (pose === 'rifle') {
          grips = {
            rear: new THREE.Vector3(midX, bb.min.y + ht * 0.18, bb.max.z - len * 0.30),
            fore: new THREE.Vector3(midX, bb.min.y + ht * 0.22, bb.min.z + len * 0.30),
          };
        } else if (pose === 'pistol') {
          grips = {
            rear: new THREE.Vector3(midX, bb.min.y + ht * 0.10, bb.max.z - len * 0.18),
            fore: new THREE.Vector3(midX - 0.04, bb.min.y + ht * 0.04, bb.max.z - len * 0.14),
          };
        } else { // knife: fist on the handle (rear-bottom quarter of the bbox)
          grips = { rear: new THREE.Vector3(midX, bb.min.y + ht * 0.35, bb.max.z - len * 0.22) };
        }
      }
    } catch (e) { /* fall back to default anchors */ }
    this.arms = makeArms(this.deps.team ? this.deps.team() : 't', pose, grips);
    this.arms.traverse((o) => { o.userData.isArms = true; });
    this.holder.add(this.arms);
  }

  refreshAppearance() { this._mountViewmodel(); }

  ownedWeaponForKey(key) {
    if (key === 3) return 'knife';
    if (key === 2) return this.loadout.secondary;
    if (key === 1) return this.loadout.primary;
    return null;
  }

  switchTo(id) {
    if (!id || !WEAPONS[id] || id === this.current || this.switchT < 1) return;
    const owned = id === 'knife' || this.loadout.primary === id || this.loadout.secondary === id;
    if (!owned) return;
    this.current = id;
    this.reloading = false;
    this.scoped = false;
    this.switchT = 0;
    this.shotIndex = 0;
    this._mountViewmodel();
    this.deps.ui.setWeapon(this.cfg.name, this.ammo);
    this.deps.ui.setReloading(false);
    audio.playSwitch();
  }

  startReload() {
    const a = this.ammo;
    if (this.reloading || this.locked || a.mag >= this.cfg.mag || a.reserve <= 0 || this.current === 'knife') return;
    this.reloading = true;
    this.scoped = false;
    this.reloadT = 0;
    audio.playReload(this.current);
    this.deps.ui.setReloading(true);
    this.deps.onReload && this.deps.onReload();
  }

  trySetScope(on) {
    if (this.cfg.zoom == null) { this.scoped = false; return; }
    if (this.reloading) on = false;
    this.scoped = on;
  }

  pullTrigger(held) { this.triggerHeld = held; }

  _spread(moveFactor) {
    const c = this.cfg;
    if (this.current === 'awp') {
      return this.scoped ? c.spreadScoped : c.spreadBase + moveFactor * c.spreadMove;
    }
    const s = c.spreadBase + moveFactor * c.spreadMove + this.shotIndex * c.spreadShot * 0.45;
    return Math.min(s, c.spreadMax);
  }

  update(dt, ctx) {
    const c = this.cfg;
    this.cooldown -= dt;
    this.sprayResetT -= dt;
    if (this.sprayResetT <= 0 && this.shotIndex > 0) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 18);
    }
    if (this.switchT < 1) this.switchT = Math.min(1, this.switchT + dt * 3.2);

    if (this.reloading) {
      this.reloadT += dt * 1000;
      if (this.reloadT >= c.reloadMs) {
        const a = this.ammo;
        const need = c.mag - a.mag;
        const take = a.reserve === Infinity ? need : Math.min(need, a.reserve);
        a.mag += take;
        if (a.reserve !== Infinity) a.reserve -= take;
        this.reloading = false;
        this.deps.ui.setReloading(false);
        this.deps.ui.setAmmo(a);
      }
    }

    if (this.triggerHeld && this.cooldown <= 0 && this.switchT >= 0.85 && !this.reloading && !ctx.dead && !this.locked) {
      const a = this.ammo;
      if (a.mag > 0) {
        this._fire(ctx);
        if (!c.auto) this.triggerHeld = false;
      } else {
        audio.playDryFire();
        this.startReload();
        this.triggerHeld = false;
      }
    }

    const snap = c.recoilSnap, rec = c.recoilRecover;
    this.recoilPitch += (this.recoilTargetP - this.recoilPitch) * Math.min(1, snap * dt);
    this.recoilYaw += (this.recoilTargetY - this.recoilYaw) * Math.min(1, snap * dt);
    this.recoilTargetP *= Math.max(0, 1 - rec * dt);
    this.recoilTargetY *= Math.max(0, 1 - rec * dt);
    this.kick *= Math.max(0, 1 - 10 * dt);

    // --- viewmodel pose ---
    const speed = ctx.speed || 0;
    this.bobT += dt * (4 + speed * 1.3);
    const bobA = Math.min(speed / 6, 1) * (ctx.onGround ? 0.011 : 0.004);
    const bobX = Math.cos(this.bobT) * bobA;
    const bobY = Math.abs(Math.sin(this.bobT)) * bobA * 1.4;

    const raise = 1 - Math.pow(1 - this.switchT, 2);
    let rx = 0, ry = 0, py = 0;
    if (this.reloading) {
      const k = Math.sin(Math.min(1, this.reloadT / c.reloadMs) * Math.PI);
      rx = 0.55 * k; py = -0.12 * k;
    }
    const scopeHide = (this.scoped && this.current === 'awp') ? 1 : 0;

    this.holder.position.set(
      c.vmPos[0] + bobX,
      c.vmPos[1] + bobY - (1 - raise) * 0.45 + py - scopeHide * 0.4,
      c.vmPos[2] + this.kick,
    );
    this.holder.rotation.set(
      rx + this.kick * 1.2 + (1 - raise) * 0.7,
      ry, bobX * 0.6,
    );
  }

  _castRay(spread, targets) {
    const { camera } = this.deps;
    tmpDir.copy(FORWARD).applyQuaternion(camera.quaternion);
    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const dir = tmpDir.clone()
      .addScaledVector(tmpRight, (Math.random() - 0.5) * 2 * spread)
      .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
      .normalize();
    this.raycaster.set(camera.position, dir);
    this.raycaster.far = this.cfg.range;
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (h.object.userData.ownerId === 'me') continue;
      return { hit: h, dir };
    }
    return { hit: null, dir };
  }

  _fire(ctx) {
    const { camera, effects } = this.deps;
    const c = this.cfg;
    const a = this.ammo;
    if (a.mag !== Infinity) a.mag--;
    this.cooldown = 60 / c.rpm;
    this.sprayResetT = 0.25;
    this.deps.ui.setAmmo(a);

    const spread = this._spread(ctx.moveFactor || 0);
    const targets = this.deps.raycastTargets();
    const pelletCount = c.pellets || 1;
    const victims = new Map(); // id -> {zone, pellets}
    let mainDir = null, mainEnd = null;

    for (let i = 0; i < pelletCount; i++) {
      const { hit, dir } = this._castRay(spread, targets);
      if (!mainDir) {
        mainDir = dir;
        mainEnd = hit ? hit.point.clone() : dir.clone().multiplyScalar(c.range).add(camera.position);
      }
      if (hit) {
        const pid = hit.object.userData.playerId;
        if (pid) {
          const zone = hit.object.userData.zone || 'body';
          const v = victims.get(pid) || { zone, pellets: 0 };
          v.pellets++;
          // zone priority: head > body > legs
          const rank = { head: 2, body: 1, legs: 0 };
          if ((rank[zone] ?? 1) > (rank[v.zone] ?? 1)) v.zone = zone;
          victims.set(pid, v);
          effects.impact(hit.point, hit.face ? hit.face.normal : null, true);
        } else {
          effects.impact(hit.point, hit.face ? hit.face.normal : null, false);
        }
      }
    }

    const muzzle = camera.position.clone()
      .addScaledVector(mainDir, 0.7)
      .addScaledVector(tmpRight, 0.18)
      .add(new THREE.Vector3(0, -0.12, 0));

    if (this.current !== 'knife') {
      effects.tracer(muzzle, mainEnd);
      effects.shell(muzzle, tmpRight);
      this.muzzleFlashVM();
    }
    audio.playGunshot(this.current, 1);

    const idx = this.shotIndex;
    const side = Math.sin(idx * 0.55) * c.recoilSide * (idx > 4 ? 1 : 0.35);
    this.recoilTargetP += c.recoilUp * (1 + Math.min(idx, 10) * 0.06);
    this.recoilTargetY += side + (Math.random() - 0.5) * c.recoilSide * 0.5;
    this.kick = c.kickBack;
    this.shotIndex = Math.min(this.shotIndex + 1, 14);
    if (this.scoped && this.current === 'awp') this.scoped = false;

    const hitsPayload = [...victims.entries()].map(([id, v]) => ({ id, zone: v.zone, pellets: v.pellets }));
    this.deps.onShoot({
      origin: muzzle.toArray().map((v) => +v.toFixed(2)),
      dir: mainDir.toArray().map((v) => +v.toFixed(3)),
      hits: hitsPayload,
    });
  }

  muzzleFlashVM() {
    const flashPos = new THREE.Vector3(
      this.holder.position.x + 0.02,
      this.holder.position.y + 0.05,
      this.holder.position.z - 0.55,
    );
    const s = new THREE.Sprite(this.deps.effects.flashMat.clone());
    s.position.copy(flashPos);
    const sc = 0.22 + Math.random() * 0.12;
    s.scale.set(sc, sc, sc);
    this.vmScene.add(s);
    setTimeout(() => { this.vmScene.remove(s); s.material.dispose(); }, 45);
  }

  getRecoil() { return { pitch: this.recoilPitch, yaw: this.recoilYaw }; }
  isScoped() { return this.scoped && this.current === 'awp'; }
}
