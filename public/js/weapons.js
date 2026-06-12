// ===== First-person weapon system: viewmodel, recoil, spread, reload =====
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { assets } from './assets.js';
import * as audio from './audio.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();

export class WeaponSystem {
  /**
   * @param vmScene  separate overlay scene for the viewmodel
   * @param deps { camera, effects, raycastTargets(), onShoot(payload), onHit(payload), ui }
   */
  constructor(vmScene, deps) {
    this.vmScene = vmScene;
    this.deps = deps;
    this.raycaster = new THREE.Raycaster();

    this.holder = new THREE.Group(); // holds current viewmodel
    vmScene.add(this.holder);

    this.inventory = {};
    for (const id of Object.keys(WEAPONS)) {
      this.inventory[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    this.current = 'ak47';
    this.vm = null;

    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.shotIndex = 0;       // spray position
    this.sprayResetT = 0;
    this.recoilPitch = 0;     // applied camera recoil (current)
    this.recoilYaw = 0;
    this.recoilTargetP = 0;
    this.recoilTargetY = 0;
    this.kick = 0;            // viewmodel kickback
    this.switchT = 1;         // raise animation 0..1
    this.bobT = 0;
    this.scoped = false;
    this.triggerHeld = false;

    this._mountViewmodel();
  }

  get cfg() { return WEAPONS[this.current]; }
  get ammo() { return this.inventory[this.current]; }

  _mountViewmodel() {
    if (this.vm) this.holder.remove(this.vm);
    const cfg = this.cfg;
    const template = assets.guns[cfg.model];
    this.vm = template ? template.clone() : new THREE.Group();
    this.vm.scale.setScalar(cfg.vmScale);
    this.vm.rotation.set(...cfg.vmRot);
    this.holder.add(this.vm);
  }

  switchTo(id) {
    if (!WEAPONS[id] || id === this.current || this.switchT < 1) return;
    this.current = id;
    this.reloading = false;
    this.scoped = false;
    this.switchT = 0;
    this.shotIndex = 0;
    this._mountViewmodel();
    this.deps.ui.setWeapon(this.cfg.name, this.ammo);
  }

  startReload() {
    const a = this.ammo;
    if (this.reloading || a.mag >= this.cfg.mag || a.reserve <= 0 || this.current === 'knife') return;
    this.reloading = true;
    this.scoped = false;
    this.reloadT = 0;
    audio.playReload(this.current);
    this.deps.ui.setReloading(true);
  }

  trySetScope(on) {
    if (this.cfg.zoom == null) { this.scoped = false; return; }
    if (this.reloading) on = false;
    this.scoped = on;
  }

  pullTrigger(held) {
    this.triggerHeld = held;
  }

  _spread(moveFactor) {
    const c = this.cfg;
    if (this.current === 'awp') {
      return this.scoped ? c.spreadScoped : c.spreadBase + moveFactor * c.spreadMove;
    }
    const s = c.spreadBase + moveFactor * c.spreadMove + this.shotIndex * c.spreadShot * 0.45;
    return Math.min(s, c.spreadMax);
  }

  /** called every frame from main loop */
  update(dt, ctx) {
    const { camera, effects } = this.deps;
    const c = this.cfg;
    this.cooldown -= dt;
    this.sprayResetT -= dt;
    if (this.sprayResetT <= 0 && this.shotIndex > 0) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 18);
    }
    if (this.switchT < 1) this.switchT = Math.min(1, this.switchT + dt * 3.2);

    // reload progress
    if (this.reloading) {
      this.reloadT += dt * 1000;
      if (this.reloadT >= c.reloadMs) {
        const a = this.ammo;
        const need = c.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
        this.reloading = false;
        this.deps.ui.setReloading(false);
        this.deps.ui.setAmmo(a);
      }
    }

    // firing
    if (this.triggerHeld && this.cooldown <= 0 && this.switchT >= 0.85 && !this.reloading && !ctx.dead) {
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

    // recoil decay toward 0; current chases target
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

    // scope FOV handled by main via getter
  }

  _fire(ctx) {
    const { camera, effects } = this.deps;
    const c = this.cfg;
    const a = this.ammo;
    a.mag--;
    this.cooldown = 60 / c.rpm;
    this.sprayResetT = 0.25;
    this.deps.ui.setAmmo(a);

    // direction with spread
    const spread = this._spread(ctx.moveFactor || 0);
    tmpDir.copy(FORWARD).applyQuaternion(camera.quaternion);
    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    tmpDir.addScaledVector(tmpRight, (Math.random() - 0.5) * 2 * spread)
      .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
      .normalize();

    // raycast
    this.raycaster.set(camera.position, tmpDir);
    this.raycaster.far = c.range;
    const targets = this.deps.raycastTargets();
    const hits = this.raycaster.intersectObjects(targets, true);
    let hit = null;
    for (const h of hits) {
      if (h.object.userData.ownerId === 'me') continue;
      hit = h; break;
    }

    const end = hit ? hit.point : tmpDir.clone().multiplyScalar(c.range).add(camera.position);
    const muzzle = camera.position.clone()
      .addScaledVector(tmpDir, 0.7)
      .addScaledVector(tmpRight, 0.18)
      .add(new THREE.Vector3(0, -0.12, 0));

    if (this.current !== 'knife') {
      effects.tracer(muzzle, end);
      effects.shell(muzzle, tmpRight);
      this.muzzleFlashVM();
    }
    audio.playGunshot(this.current, 1);

    // recoil: CS-like — climbs up, drifts sideways as spray continues
    const idx = this.shotIndex;
    const side = Math.sin(idx * 0.55) * c.recoilSide * (idx > 4 ? 1 : 0.35);
    this.recoilTargetP += c.recoilUp * (1 + Math.min(idx, 10) * 0.06);
    this.recoilTargetY += side + (Math.random() - 0.5) * c.recoilSide * 0.5;
    this.kick = c.kickBack;
    this.shotIndex = Math.min(this.shotIndex + 1, 14);
    if (this.scoped && this.current === 'awp') this.scoped = false; // unscope on shot

    // resolve hit
    if (hit) {
      const pid = hit.object.userData.playerId;
      if (pid) {
        const head = hit.object.userData.zone === 'head';
        effects.impact(hit.point, hit.face ? hit.face.normal : null, true);
        this.deps.onHit({ targetId: pid, head });
      } else {
        effects.impact(hit.point, hit.face ? hit.face.normal : null, false);
      }
    }
    this.deps.onShoot({
      origin: muzzle.toArray().map((v) => +v.toFixed(2)),
      dir: tmpDir.toArray().map((v) => +v.toFixed(3)),
    });
  }

  muzzleFlashVM() {
    // flash inside viewmodel scene at barrel tip
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
