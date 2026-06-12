// ===== de_arena — CS-style 3-lane map =====
// Rotationally symmetric (180°): T spawn SW ↔ CT spawn NE,
// A plaza SE ↔ B plaza NW, mid corridor with door choke in center.
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

function makeTextures() {
  const floor = canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#bfae84'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 4000);
    ctx.strokeStyle = 'rgba(90,75,50,.25)'; ctx.lineWidth = 2;
    const tile = s / 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(s, i * tile); ctx.stroke();
    }
    for (let i = 0; i < 24; i++) { // cracks/stains
      ctx.fillStyle = `rgba(${100 + Math.random() * 40 | 0},${85 + Math.random() * 30 | 0},55,.12)`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 8 + Math.random() * 36, 6 + Math.random() * 22, Math.random() * 3, 0, 7);
      ctx.fill();
    }
  });

  const wall = canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#cdb98f'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.045, 3000);
    // plaster strata
    for (let y = 0; y < s; y += 64) {
      ctx.fillStyle = `rgba(120,100,70,${0.05 + Math.random() * 0.05})`;
      ctx.fillRect(0, y, s, 30 + Math.random() * 20);
    }
    // dirt at bottom
    const g = ctx.createLinearGradient(0, s * 0.7, 0, s);
    g.addColorStop(0, 'rgba(80,65,45,0)'); g.addColorStop(1, 'rgba(80,65,45,.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    // bullet pocks
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(70,60,45,.4)';
      ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s * 0.8, 1.5 + Math.random() * 3, 0, 7); ctx.fill();
    }
  });

  const crate = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#8d6b40'; ctx.fillRect(0, 0, s, s);
    const pw = s / 4;
    for (let i = 0; i < 4; i++) { // planks
      ctx.fillStyle = `rgb(${130 + Math.random() * 25 | 0},${98 + Math.random() * 18 | 0},${58 + Math.random() * 12 | 0})`;
      ctx.fillRect(0, i * pw + 2, s, pw - 4);
      ctx.fillStyle = 'rgba(60,40,20,.5)'; ctx.fillRect(0, i * pw, s, 2);
    }
    noise(ctx, s, 0.06, 1200);
    // frame
    ctx.strokeStyle = 'rgba(70,48,24,.85)'; ctx.lineWidth = 14; ctx.strokeRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(60,40,20,.5)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.stroke();
    ctx.font = 'bold 38px monospace'; ctx.fillStyle = 'rgba(40,28,14,.55)';
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
    for (let x = 0; x < s; x += 32) { // ribs
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(x, 0, 6, s);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x + 26, 0, 6, s);
    }
    ctx.fillStyle = 'rgba(140,90,40,.25)'; // rust
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

// ---------- map data ----------
// [cx, cz, w, d, h, (yBase)] — mirrored entries auto-generated
const SYM_WALLS = [
  // mid lane walls (x = ±8)
  [-8, -27, 1, 22, 6],   // W1a: B-plaza east wall, leaves B door z[-16..-8]
  [-8, -1, 1, 14, 6],    // W1b: mid west wall z[-8..6]
  // mid door stubs at z=0 (gap x[-3..3])
  [-5.5, 0, 5, 1, 6],
  // big side buildings (solid)
  [-24, 0, 32, 28, 7],   // B1: x[-40..-8], z[-14..14]
];
const SYM_LOW = [ // cover walls
  [0, 12, 6, 0.4, 1.15],     // mid cover before doors
  [-24, -20, 0.5, 6, 2.2],   // plaza cover wall
  [-44.5, 14.5, 7, 0.4, 1.15], // west corridor mouth cover
];
const SYM_CRATES = [ // [x, z, size, stack]
  // B plaza (site B) — NW
  [-30, -25, 1.6, 2], [-28.2, -26.5, 1.6, 1], [-31.8, -23.2, 1.6, 1],
  [-26, -32, 2.2, 1], [-14, -19, 1.6, 1], [-36, -18, 1.6, 1],
  // mid near door
  [-6.6, 2.8, 1.4, 1],
  // west corridor
  [-44, -4, 1.7, 1],
  // T spawn cover
  [-22, 20, 1.8, 1], [-38, 33, 1.6, 1],
];
const SYM_PLATFORMS = [ // [cx, cz, w, d, h] + stairs dir
  [-16, -34, 8, 8, 2.0, 'E'], // B heaven (NW corner), stairs on east side
];

const SITE_MARKS = [ ['B', -30, -25], ['A', 30, 25] ];

function mirror(e) { return [-e[0], -e[1], ...e.slice(2)]; }

export function buildMapData() {
  const walls = [
    // perimeter (h=8)
    [0, -38.5, 98, 1, 8], [0, 38.5, 98, 1, 8],
    [-48.5, 0, 1, 78, 8], [48.5, 0, 1, 78, 8],
  ];
  for (const w of SYM_WALLS) { walls.push(w, mirror(w)); }
  const lows = [];
  for (const w of SYM_LOW) { lows.push(w, mirror(w)); }
  const crates = [];
  for (const c of SYM_CRATES) { crates.push(c, mirror(c)); }
  const platforms = [];
  for (const p of SYM_PLATFORMS) {
    platforms.push(p, [-p[0], -p[1], p[2], p[3], p[4], p[5] === 'E' ? 'W' : 'E']);
  }
  return { walls, lows, crates, platforms };
}

export function buildMap(scene) {
  const tex = makeTextures();
  const { walls, lows, crates, platforms } = buildMapData();
  const colliders = []; // THREE.Box3
  const raycastMeshes = [];

  const addCollider = (cx, cy, cz, w, h, d) => {
    colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
      new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
    ));
  };

  // --- floor ---
  const floorGeo = new THREE.PlaneGeometry(100, 80);
  floorGeo.rotateX(-Math.PI / 2);
  const uv = floorGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 26, uv.getY(i) * 21);
  const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ map: tex.floor }));
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  raycastMeshes.push(floorMesh);
  colliders.push(new THREE.Box3(new THREE.Vector3(-50, -1, -40), new THREE.Vector3(50, 0, 40)));

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
    // stairs: 4 steps of h/4
    const steps = 4, stepH = h / steps, stepD = 0.9;
    for (let i = 0; i < steps; i++) {
      const sh = h - i * stepH; // tallest near platform
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
  for (const [letter, x, z] of SITE_MARKS) {
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
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 top = vec3(0.36,0.56,0.83);
          vec3 hor = vec3(0.87,0.80,0.66);
          vec3 col = mix(hor, top, clamp(h*1.6, 0.0, 1.0));
          // sun
          vec3 sd = normalize(vec3(0.55,0.62,0.25));
          float s = pow(max(dot(normalize(vP), sd), 0.0), 600.0);
          col += vec3(1.0,0.95,0.8)*s*1.6;
          gl_FragColor = vec4(col,1.0);
        }`,
    })
  );
  scene.add(sky);

  scene.fog = new THREE.Fog(0xd8cba8, 90, 220);
  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0xb09a6e, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
  sun.position.set(45, 65, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 160;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  return { colliders, raycastMeshes, mapData: { walls, lows, crates, platforms } };
}
