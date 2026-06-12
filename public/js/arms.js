// ===== Procedural first-person arms — CS-style detailed hands =====
// Jointed arms (shoulder→elbow→wrist), gloved hands with individual fingers
// wrapping the grips, sleeve cuffs and knuckle pads. Low-poly, no textures.
import * as THREE from 'three';

const SKIN_COLOR = 0xc9a182;
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);

/** Tapered cylinder spanning two points. */
function seg(from, to, r1, r2, mat, radial = 10) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, radial), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return m;
}

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }

/**
 * Detailed gloved hand. Local space: palm faces -Y, fingers point -Z (curled
 * around a horizontal grip), thumb on +X for right hand / -X for left.
 */
function makeHand(gloveMat, skinMat, padMat, side = 1, curl = 0.85) {
  const g = new THREE.Group();
  // palm
  const palm = box(0.072, 0.03, 0.085, gloveMat);
  g.add(palm);
  // knuckle pad (CS glove detail)
  const pad = box(0.06, 0.014, 0.04, padMat);
  pad.position.set(0, 0.02, -0.025);
  g.add(pad);
  // skin gap at the wrist (glove cuff shows a bit of skin)
  const wristSkin = seg(new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(0, 0, 0.075), 0.03, 0.032, skinMat, 8);
  g.add(wristSkin);

  // 4 fingers, 2 segments each, curling around the grip
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.017;
    const f = new THREE.Group();
    f.position.set(x, -0.005, -0.042);
    const p1 = box(0.014, 0.014, 0.03, gloveMat); // proximal
    p1.position.z = -0.013;
    const knee = new THREE.Group();
    knee.position.z = -0.028;
    knee.rotation.x = curl * (1 + i * 0.04); // inner fingers curl a touch more
    const p2 = box(0.013, 0.013, 0.028, gloveMat); // distal, curled down
    p2.position.z = -0.012;
    knee.add(p2);
    f.add(p1, knee);
    f.rotation.x = curl * 0.55;
    g.add(f);
  }
  // thumb wrapping the other side
  const th = new THREE.Group();
  th.position.set(side * 0.035, -0.012, -0.01);
  th.rotation.set(0.5, side * -0.9, 0);
  const t1 = box(0.015, 0.015, 0.034, gloveMat);
  t1.position.z = -0.015;
  const t2 = box(0.013, 0.013, 0.026, gloveMat);
  t2.position.z = -0.04;
  t2.rotation.x = 0.6;
  th.add(t1, t2);
  g.add(th);
  return g;
}

/**
 * Full jointed arm: shoulder (off-screen) → elbow → wrist + detailed hand.
 * `gripDir` = local -Z of the hand (where fingers wrap), `side` 1=right, -1=left.
 */
function arm(shoulder, wrist, mats, side, pose) {
  const { sleeveMat, skinMat, gloveMat, padMat } = mats;
  const g = new THREE.Group();
  // elbow: drop the midpoint down/outward for a natural bend
  const elbow = shoulder.clone().lerp(wrist, 0.45);
  elbow.y -= 0.10;
  elbow.x += side * 0.05;
  // upper arm (thicker sleeve) and forearm (tapers to the wrist)
  g.add(seg(shoulder, elbow, 0.075, 0.06, sleeveMat));
  const cuffEnd = elbow.clone().lerp(wrist, 0.72);
  g.add(seg(elbow, cuffEnd, 0.058, 0.047, sleeveMat));
  // sleeve cuff ring
  g.add(seg(cuffEnd, cuffEnd.clone().lerp(wrist, 0.12), 0.05, 0.05, padMat, 10));
  // bare forearm skin to the glove
  g.add(seg(cuffEnd.clone().lerp(wrist, 0.1), wrist.clone().lerp(cuffEnd, -0.05), 0.042, 0.034, skinMat));
  // elbow pad
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), padMat);
  pad.position.copy(elbow);
  g.add(pad);

  const hand = makeHand(gloveMat, skinMat, padMat, side, pose === 'knife' ? 1.15 : 0.85);
  hand.position.copy(wrist);
  // orient the hand: fingers along the grip (gun forward is -Z in holder space)
  const aim = wrist.clone().sub(shoulder).normalize();
  hand.quaternion.setFromUnitVectors(FWD, aim.lerp(FWD, pose === 'rifle' ? 0.55 : 0.35).normalize());
  hand.rotateZ(side * (pose === 'pistol' ? 0.25 : 0.45)); // wrap around the grip
  g.add(hand);
  return g;
}

/**
 * Builds an arms rig group meant to be added to the weapon holder.
 * Holder space: gun at origin, -Z is forward (muzzle), camera roughly at (-0.28, 0.26, 0.55).
 * pose: 'rifle' | 'pistol' | 'knife'
 */
export function makeArms(team, pose = 'rifle') {
  const g = new THREE.Group();
  const mats = {
    sleeveMat: new THREE.MeshLambertMaterial({ color: team === 't' ? 0x5a4a30 : 0x2e3f54 }),
    skinMat: new THREE.MeshLambertMaterial({ color: SKIN_COLOR }),
    gloveMat: new THREE.MeshLambertMaterial({ color: 0x23262b }),
    padMat: new THREE.MeshLambertMaterial({ color: team === 't' ? 0x46391f : 0x1f2c3e }),
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  if (pose === 'rifle') {
    // right hand on the rear grip, left hand on the foregrip
    g.add(arm(V(0.12, -0.6, 0.62), V(0.015, -0.07, 0.1), mats, 1, pose));
    g.add(arm(V(-0.4, -0.58, 0.52), V(-0.015, -0.06, -0.22), mats, -1, pose));
  } else if (pose === 'pistol') {
    // two-handed pistol grip, support hand cups the firing hand
    g.add(arm(V(0.14, -0.6, 0.62), V(0.02, -0.09, 0.06), mats, 1, pose));
    g.add(arm(V(-0.32, -0.62, 0.56), V(-0.03, -0.105, 0.085), mats, -1, pose));
  } else { // knife — right arm only, tight fist
    g.add(arm(V(0.14, -0.6, 0.62), V(0.01, -0.06, 0.08), mats, 1, pose));
  }
  return g;
}

export function poseForWeapon(cfg) {
  if (cfg.slot === 'melee') return 'knife';
  if (cfg.slot === 'secondary') return 'pistol';
  return 'rifle';
}
