// ===== Visual effects: tracers, impacts, muzzle flash, shells, blood =====
import * as THREE from 'three';

const tmpV = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // { obj, life, ttl, update }

    // shared resources
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
    this.tracerGeo.rotateX(Math.PI / 2); // align with Z

    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = flashCanvas.height = 64;
    const fc = flashCanvas.getContext('2d');
    const grad = fc.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.3, 'rgba(255,200,90,.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    fc.fillStyle = grad; fc.fillRect(0, 0, 64, 64);
    this.flashTex = new THREE.CanvasTexture(flashCanvas);
    this.flashMat = new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

    this.sparkGeo = new THREE.BufferGeometry();
    this.shellGeo = new THREE.BoxGeometry(0.02, 0.02, 0.05);
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
  }

  add(obj, ttl, update) {
    this.scene.add(obj);
    this.items.push({ obj, life: 0, ttl, update });
  }

  tracer(from, to) {
    const dir = tmpV.copy(to).sub(from);
    const len = dir.length();
    if (len < 1.5) return;
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    mesh.scale.z = len;
    mesh.position.copy(from).addScaledVector(dir.normalize(), 0); // origin
    mesh.position.copy(from).add(dir.multiplyScalar(len / 2));
    mesh.lookAt(to);
    mesh.scale.set(1, 1, len);
    this.add(mesh, 0.07, (it, k) => { it.obj.material.opacity = 1 - k; });
  }

  muzzleFlash(pos, big = false) {
    const s = new THREE.Sprite(this.flashMat.clone());
    s.position.copy(pos);
    const sc = (big ? 0.55 : 0.35) * (0.8 + Math.random() * 0.4);
    s.scale.set(sc, sc, sc);
    s.material.rotation = Math.random() * Math.PI;
    this.add(s, 0.05, (it, k) => { it.obj.material.opacity = 1 - k; });
  }

  impact(pos, normal, isBlood = false) {
    const count = isBlood ? 10 : 8;
    const positions = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2 + (normal ? normal.x * 2 : 0),
        Math.random() * 2.5 + (normal ? normal.y * 2 : 0),
        (Math.random() - 0.5) * 2 + (normal ? normal.z * 2 : 0),
      );
      vels.push(v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: isBlood ? 0xaa1111 : 0xcdb98f, size: isBlood ? 0.06 : 0.045,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    this.add(pts, 0.45, (it, k, dt) => {
      const arr = it.obj.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        vels[i].y -= 9 * dt;
        arr.setXYZ(i, arr.getX(i) + vels[i].x * dt, arr.getY(i) + vels[i].y * dt, arr.getZ(i) + vels[i].z * dt);
      }
      arr.needsUpdate = true;
      it.obj.material.opacity = 1 - k;
    });
  }

  shell(pos, rightDir) {
    const m = new THREE.Mesh(this.shellGeo, this.shellMat);
    m.position.copy(pos);
    const vel = tmpV.copy(rightDir).multiplyScalar(1.5 + Math.random());
    vel.y = 2 + Math.random();
    const v = vel.clone();
    const rot = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    this.add(m, 0.9, (it, k, dt) => {
      v.y -= 10 * dt;
      it.obj.position.addScaledVector(v, dt);
      it.obj.rotation.x += rot.x * dt; it.obj.rotation.y += rot.y * dt;
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      const k = Math.min(1, it.life / it.ttl);
      if (it.update) it.update(it, k, dt);
      if (it.life >= it.ttl) {
        this.scene.remove(it.obj);
        if (it.obj.geometry && it.obj.geometry !== this.tracerGeo && it.obj.geometry !== this.shellGeo) it.obj.geometry.dispose();
        if (it.obj.material && it.obj.material !== this.shellMat) it.obj.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
