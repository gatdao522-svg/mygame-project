// ===== Asset loading: GLB/GLTF models =====
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const assets = {
  guns: {},      // model key -> THREE.Group (template)
  chars: {},     // 't' | 'ct' -> { scene, clips }
  ready: false,
};

const loader = new GLTFLoader();

function load(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function prepGun(gltf) {
  const g = gltf.scene;
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      if (o.material) { o.material.metalness = 0; }
    }
  });
  // normalize so longest dimension = 1
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const wrap = new THREE.Group();
  const center = box.getCenter(new THREE.Vector3());
  g.position.sub(center);
  wrap.add(g);
  wrap.scale.setScalar(1 / maxDim);
  const holder = new THREE.Group();
  holder.add(wrap);
  return holder;
}

// fallback procedural knife (no good CC0 knife glb)
function makeKnife() {
  const holder = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 0.16, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.9, roughness: 0.25 })
  );
  blade.position.z = -0.36;
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.05, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xe8eef4, metalness: 0.9, roughness: 0.15 })
  );
  edge.position.set(0, -0.08, -0.36);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.2, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6 })
  );
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.9 })
  );
  handle.rotation.x = Math.PI / 2; handle.position.z = 0.17;
  holder.add(blade, edge, guard, handle);
  return holder;
}

function prepChar(gltf, teamColor) {
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = true;
      if (o.material) {
        o.material = o.material.clone();
        if (teamColor && /pants|shirt|body|jacket|torso|cloth/i.test(o.material.name + o.name)) {
          o.material.color = new THREE.Color(teamColor).lerp(o.material.color || new THREE.Color(1, 1, 1), 0.45);
        }
      }
    }
  });
  return { scene, clips: gltf.animations };
}

export async function loadAssets(onProgress) {
  const gunFiles = {
    ak: 'AK-47', pistol: 'USP', sniper: 'AWP',
    m4: 'M4A4', mp5: 'MP5', shotgun: 'Nova', deagle: 'Deagle',
  };
  const steps = [];
  for (const [key, label] of Object.entries(gunFiles)) {
    steps.push([`Оружие: ${label}`, async () => {
      assets.guns[key] = prepGun(await load(`assets/${key}.glb`));
    }]);
  }
  steps.push(['Нож', async () => {
    try { assets.guns.knife = prepGun(await load('assets/knife.glb')); }
    catch { assets.guns.knife = makeKnife(); }
  }]);
  steps.push(['Персонаж: спецназ', async () => {
    assets.chars.ct = prepChar(await load('assets/char_ct.glb'), 0x4d7fb5);
  }]);
  steps.push(['Персонаж: боевик', async () => {
    assets.chars.t = prepChar(await load('assets/char_t.glb'), 0xb58a3d);
  }]);

  let done = 0;
  for (const [label, fn] of steps) {
    onProgress && onProgress(label, done / steps.length);
    try { await fn(); } catch (e) { console.warn('asset failed:', label, e); }
    done++;
  }
  assets.ready = true;
  onProgress && onProgress('Готово', 1);
}
