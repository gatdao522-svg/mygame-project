// ===== Data-driven map builder (maps.json) =====
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- procedural textures ----------
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(repeat, repeat);
  return t;
}

function noise(ctx, s, alpha, n = 1800) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255 | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function makeTextures(pal) {
  const floor = canvasTex(512, (ctx, s) => {
    ctx.fillStyle = pal.floor; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 4000);
    ctx.strokeStyle = 'rgba(60,55,45,.22)'; ctx.lineWidth = 2;
    const tile = s / 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(s, i * tile); ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(${70 + Math.random() * 40 | 0},${60 + Math.random() * 30 | 0},45,.12)`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 8 + Math.random() * 36, 6 + Math.random() * 22, Math.random() * 3, 0, 7);
      ctx.fill();
    }
  });

  const wall = canvasTex(512, (ctx, s) => {
    ctx.fillStyle = pal.wall; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.045, 3000);
    for (let y = 0; y < s; y += 64) {
      ctx.fillStyle = `rgba(80,70,55,${0.05 + Math.random() * 0.05})`;
      ctx.fillRect(0, y, s, 30 + Math.random() * 20);
    }
    const g = ctx.createLinearGradient(0, s * 0.7, 0, s);
    g.addColorStop(0, 'rgba(60,52,40,0)'); g.addColorStop(1, 'rgba(60,52,40,.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(60,52,42,.4)';
      ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s * 0.8, 1.5 + Math.random() * 3, 0, 7); ctx.fill();
    }
  });

  const crate = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = pal.crate; ctx.fillRect(0, 0, s, s);
    const pw = s / 4;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(255,235,200,${0.06 + Math.random() * 0.08})`;
      ctx.fillRect(0, i * pw + 2, s, pw - 4);
      ctx.fillStyle = 'rgba(40,28,16,.5)'; ctx.fillRect(0, i * pw, s, 2);
    }
    noise(ctx, s, 0.06, 1200);
    ctx.strokeStyle = 'rgba(50,36,20,.85)'; ctx.lineWidth = 14; ctx.strokeRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(45,32,18,.5)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.stroke();
    ctx.font = 'bold 38px monospace'; ctx.fillStyle = 'rgba(30,22,12,.55)';
    ctx.textAlign = 'center'; ctx.save();
    ctx.translate(s / 2, s / 2); ctx.fillText('ARENA', 0, 12); ctx.restore();
  });

  const concrete = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#9a9690'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.06, 2500);
    ctx.fillStyle = 'rgba(60,58,55,.18)';
    for (let i = 0; i < 10; i++) ctx.fillRect(Math.random() * s, Math.random() * s, 30 + Math.random() * 60, 2);
  });

  const metal = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#6e7479'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 1500);
    for (let x = 0; x < s; x += 32) {
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(x, 0, 6, s);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x + 26, 0, 6, s);
    }
    ctx.fillStyle = 'rgba(140,90,40,.25)';
    for (let i = 0; i < 12; i++) {
      ctx.beginPath(); ctx.ellipse(Math.random() * s, Math.random() * s, 6 + Math.random() * 18, 4 + Math.random() * 10, 1, 0, 7); ctx.fill();
    }
  });

  return { floor, wall, crate, concrete, metal };
}

// scale box UVs so textures keep world-space density
function boxGeo(w, h, d, texScale = 0.45) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * su * texScale, uv.getY(i) * sv * texScale);
    }
  }
  return g;
}

/**
 * Builds the world from a map definition (entry of maps.json).
 * Returns { colliders, raycastMeshes, mapData }.
 */
export function buildMap(scene, map) {
  const pal = map.palette;
  const tex = makeTextures(pal);
  const { walls, lows, crates, platforms } = map;
  const [W, D] = map.size;
  const colliders = []; // THREE.Box3
  const raycastMeshes = [];

  const addCollider = (cx, cy, cz, w, h, d) => {
    colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
      new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
    ));
  };

  // --- floor ---
  const floorGeo = new THREE.PlaneGeometry(W, D);
  floorGeo.rotateX(-Math.PI / 2);
  const uv = floorGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 4, uv.getY(i) * D / 4);
  const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ map: tex.floor }));
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  raycastMeshes.push(floorMesh);
  colliders.push(new THREE.Box3(new THREE.Vector3(-W / 2, -1, -D / 2), new THREE.Vector3(W / 2, 0, D / 2)));

  // --- merged static groups by material ---
  const groups = { wall: [], crate: [], concrete: [], metal: [] };

  for (const [cx, cz, w, d, h] of walls) {
    const g = boxGeo(w, h, d); g.translate(cx, h / 2, cz);
    groups.wall.push(g); addCollider(cx, h / 2, cz, w, h, d);
  }
  for (const [cx, cz, w, d, h] of lows) {
    const g = boxGeo(w, h, d, 0.6); g.translate(cx, h / 2, cz);
    groups.metal.push(g); addCollider(cx, h / 2, cz, w, h, d);
  }
  for (const [cx, cz, size, stack] of crates) {
    for (let s = 0; s < stack; s++) {
      const g = boxGeo(size, size, size, 1 / size);
      const y = size / 2 + s * size;
      const rot = ((cx * 13 + cz * 7 + s * 31) % 10) * 0.03 - 0.15;
      g.rotateY(rot);
      g.translate(cx, y, cz);
      groups.crate.push(g);
      addCollider(cx, y, cz, size + 0.1, size, size + 0.1); // AABB approx of rotated crate
    }
  }
  for (const [cx, cz, w, d, h, stairDir] of platforms) {
    const g = boxGeo(w, h, d, 0.5); g.translate(cx, h / 2, cz);
    groups.concrete.push(g); addCollider(cx, h / 2, cz, w, h, d);
    const steps = 4, stepH = h / steps, stepD = 0.9;
    for (let i = 0; i < steps; i++) {
      const sh = h - i * stepH;
      const offset = (w / 2) + stepD / 2 + i * stepD;
      const sx = stairDir === 'E' ? cx + offset : cx - offset;
      const sg = boxGeo(stepD, sh, d, 0.5); sg.translate(sx, sh / 2, cz);
      groups.concrete.push(sg); addCollider(sx, sh / 2, cz, stepD, sh, d);
    }
  }

  const mats = {
    wall: new THREE.MeshLambertMaterial({ map: tex.wall }),
    crate: new THREE.MeshLambertMaterial({ map: tex.crate }),
    concrete: new THREE.MeshLambertMaterial({ map: tex.concrete }),
    metal: new THREE.MeshLambertMaterial({ map: tex.metal }),
  };
  for (const key of Object.keys(groups)) {
    if (!groups[key].length) continue;
    const merged = mergeGeometries(groups[key]);
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    raycastMeshes.push(mesh);
  }

  // --- site letters on floor ---
  for (const [letter, x, z] of map.sites || []) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 110px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180,60,30,.55)'; ctx.fillText(letter, 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z);
    scene.add(m);
  }

  // --- sky dome + lights ---
  const [tr, tg, tb] = pal.skyTop;
  const [hr, hg, hb] = pal.skyHor;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 top = vec3(${tr},${tg},${tb});
          vec3 hor = vec3(${hr},${hg},${hb});
          vec3 col = mix(hor, top, clamp(h*1.6, 0.0, 1.0));
          vec3 sd = normalize(vec3(0.55,0.62,0.25));
          float s = pow(max(dot(normalize(vP), sd), 0.0), 600.0);
          col += vec3(1.0,0.95,0.8)*s*1.6;
          gl_FragColor = vec4(col,1.0);
        }`,
    })
  );
  scene.add(sky);

  scene.fog = new THREE.Fog(new THREE.Color(pal.fog), 90, 220);
  scene.add(new THREE.HemisphereLight(new THREE.Color(pal.hemiSky), new THREE.Color(pal.hemiGround), 0.95));
  const sun = new THREE.DirectionalLight(new THREE.Color(pal.sun), 1.25);
  sun.position.set(45, 65, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  const ext = Math.max(W, D) * 0.65;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.far = 200;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  return { colliders, raycastMeshes, mapData: map };
}
