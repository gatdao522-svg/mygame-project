// ===== Procedural first-person arms (visible hands holding the weapon) =====
import * as THREE from 'three';

const SKIN_COLOR = 0xc9a182;
const UP = new THREE.Vector3(0, 1, 0);

/** Tapered cylinder spanning two points. */
function seg(from, to, r1, r2, mat) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 10), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return m;
}

/** Full arm: sleeve from elbow to wrist, skin wrist, gloved hand at `to`. */
function arm(from, to, sleeveMat, skinMat, gloveMat) {
  const g = new THREE.Group();
  const dir = to.clone().sub(from).normalize();
  const wristStart = from.clone().lerp(to, 0.78);
  g.add(seg(from, wristStart, 0.062, 0.046, sleeveMat));
  g.add(seg(wristStart, to, 0.042, 0.036, skinMat));
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.1), gloveMat);
  hand.position.copy(to).addScaledVector(dir, 0.04);
  hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  g.add(hand);
  return g;
}

/**
 * Builds an arms rig group meant to be added to the weapon holder.
 * Holder space: gun at origin, -Z is forward (muzzle), camera roughly at (-0.28, 0.26, 0.55).
 * Arms run from off-screen (bottom, near camera) to the weapon grips.
 * pose: 'rifle' | 'pistol' | 'knife'
 */
export function makeArms(team, pose = 'rifle') {
  const g = new THREE.Group();
  const sleeveMat = new THREE.MeshLambertMaterial({ color: team === 't' ? 0x5a4a30 : 0x2e3f54 });
  const skinMat = new THREE.MeshLambertMaterial({ color: SKIN_COLOR });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x23262b });

  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  if (pose === 'rifle') {
    // right hand on rear grip, left hand on foregrip
    g.add(arm(V(0.1, -0.55, 0.6), V(0.015, -0.07, 0.1), sleeveMat, skinMat, gloveMat));
    g.add(arm(V(-0.38, -0.55, 0.5), V(-0.015, -0.06, -0.22), sleeveMat, skinMat, gloveMat));
  } else if (pose === 'pistol') {
    // two-handed pistol grip
    g.add(arm(V(0.12, -0.55, 0.6), V(0.02, -0.09, 0.06), sleeveMat, skinMat, gloveMat));
    g.add(arm(V(-0.3, -0.58, 0.55), V(-0.025, -0.1, 0.08), sleeveMat, skinMat, gloveMat));
  } else { // knife — right arm only
    g.add(arm(V(0.12, -0.55, 0.6), V(0.01, -0.06, 0.08), sleeveMat, skinMat, gloveMat));
  }
  return g;
}

export function poseForWeapon(cfg) {
  if (cfg.slot === 'melee') return 'knife';
  if (cfg.slot === 'secondary') return 'pistol';
  return 'rifle';
}
