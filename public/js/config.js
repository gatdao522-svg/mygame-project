// ===== Shared game configuration =====
export const WEAPONS = {
  ak47: {
    name: 'AK-47', slot: 1, auto: true, rpm: 600,
    mag: 30, reserve: 90, reloadMs: 2400,
    dmg: 30, range: 300,
    spreadBase: 0.0012, spreadMove: 0.012, spreadShot: 0.0035, spreadMax: 0.05,
    recoilUp: 0.0205, recoilSide: 0.011, recoilSnap: 9, recoilRecover: 5.5,
    kickBack: 0.085, zoom: null,
    model: 'ak', vmPos: [0.28, -0.26, -0.55], vmRot: [0, -Math.PI / 2, 0], vmScale: 0.85,
  },
  pistol: {
    name: 'USP-9', slot: 2, auto: false, rpm: 400,
    mag: 12, reserve: 48, reloadMs: 1800,
    dmg: 26, range: 200,
    spreadBase: 0.0018, spreadMove: 0.009, spreadShot: 0.011, spreadMax: 0.045,
    recoilUp: 0.024, recoilSide: 0.006, recoilSnap: 12, recoilRecover: 8,
    kickBack: 0.06, zoom: null,
    model: 'pistol', vmPos: [0.26, -0.27, -0.5], vmRot: [0, Math.PI / 2, 0], vmScale: 0.3,
  },
  awp: {
    name: 'AWP', slot: 3, auto: false, rpm: 50,
    mag: 5, reserve: 20, reloadMs: 3200,
    dmg: 110, range: 500,
    spreadBase: 0.05, spreadMove: 0.08, spreadShot: 0.01, spreadMax: 0.12,
    spreadScoped: 0.0002,
    recoilUp: 0.055, recoilSide: 0.012, recoilSnap: 6, recoilRecover: 3.5,
    kickBack: 0.22, zoom: 4.2,
    model: 'sniper', vmPos: [0.28, -0.28, -0.62], vmRot: [0, 0, 0], vmScale: 1.1,
  },
  knife: {
    name: 'НОЖ', slot: 4, auto: true, rpm: 120,
    mag: Infinity, reserve: Infinity, reloadMs: 0,
    dmg: 55, range: 2.2,
    spreadBase: 0, spreadMove: 0, spreadShot: 0, spreadMax: 0,
    recoilUp: 0.004, recoilSide: 0.002, recoilSnap: 14, recoilRecover: 10,
    kickBack: 0.0, zoom: null,
    model: 'knife', vmPos: [0.3, -0.22, -0.45], vmRot: [-1.1, 0.35, 0.25], vmScale: 0.42,
  },
};

export const PLAYER = {
  eyeStand: 1.62, eyeCrouch: 1.08,
  heightStand: 1.8, heightCrouch: 1.25, radius: 0.38,
  runSpeed: 6.0, walkSpeed: 3.0, crouchSpeed: 2.5,
  accelGround: 60, accelAir: 8, friction: 9,
  jumpVel: 5.4, gravity: 15.5, stepUp: 0.55,
  scopedSpeedMul: 0.45,
};

export const TEAM_INFO = {
  t:  { label: 'Боевики', color: 0xe8a33d },
  ct: { label: 'Спецназ', color: 0x5ba2e8 },
};

export const NET_SEND_HZ = 15;
export const INTERP_DELAY_MS = 120;
