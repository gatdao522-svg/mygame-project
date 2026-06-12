// ===== Shared game configuration =====
// slot: 'primary' | 'secondary' | 'melee'
export const WEAPONS = {
  knife: {
    name: 'НОЖ', slot: 'melee', key: 3, price: 0, auto: true, rpm: 120,
    mag: Infinity, reserve: Infinity, reloadMs: 0,
    dmg: 55, range: 2.2, killReward: 1500,
    spreadBase: 0, spreadMove: 0, spreadShot: 0, spreadMax: 0,
    recoilUp: 0.004, recoilSide: 0.002, recoilSnap: 14, recoilRecover: 10,
    kickBack: 0.0, zoom: null,
    model: 'knife', vmPos: [0.3, -0.22, -0.45], vmRot: [-1.1, 0.35, 0.25], vmScale: 0.42,
  },
  pistol: {
    name: 'USP-9', slot: 'secondary', key: 2, price: 0, auto: false, rpm: 400,
    mag: 12, reserve: 48, reloadMs: 1800,
    dmg: 26, headMul: 3.0, range: 200, killReward: 300,
    spreadBase: 0.0018, spreadMove: 0.009, spreadShot: 0.011, spreadMax: 0.045,
    recoilUp: 0.024, recoilSide: 0.006, recoilSnap: 12, recoilRecover: 8,
    kickBack: 0.06, zoom: null,
    model: 'pistol', vmPos: [0.26, -0.27, -0.5], vmRot: [0, Math.PI / 2, 0], vmScale: 0.3,
  },
  deagle: {
    name: 'DESERT EAGLE', slot: 'secondary', key: 2, price: 700, auto: false, rpm: 267,
    mag: 7, reserve: 35, reloadMs: 2200,
    dmg: 53, headMul: 4.0, range: 250, killReward: 300,
    spreadBase: 0.003, spreadMove: 0.018, spreadShot: 0.028, spreadMax: 0.09,
    recoilUp: 0.055, recoilSide: 0.012, recoilSnap: 10, recoilRecover: 6,
    kickBack: 0.13, zoom: null,
    model: 'deagle', vmPos: [0.26, -0.26, -0.5], vmRot: [0, Math.PI / 2, 0], vmScale: 0.34,
  },
  mp5: {
    name: 'MP5-SD', slot: 'primary', key: 1, price: 1500, auto: true, rpm: 750,
    mag: 30, reserve: 120, reloadMs: 2100,
    dmg: 20, headMul: 3.0, range: 180, killReward: 600,
    spreadBase: 0.0014, spreadMove: 0.007, spreadShot: 0.0025, spreadMax: 0.04,
    recoilUp: 0.012, recoilSide: 0.007, recoilSnap: 11, recoilRecover: 7,
    kickBack: 0.06, zoom: null,
    model: 'mp5', vmPos: [0.27, -0.26, -0.52], vmRot: [0, Math.PI / 2, 0], vmScale: 0.6,
  },
  shotgun: {
    name: 'NOVA', slot: 'primary', key: 1, price: 1050, auto: false, rpm: 68,
    mag: 8, reserve: 32, reloadMs: 2800,
    dmg: 9, headMul: 2.0, range: 60, pellets: 8, killReward: 900,
    spreadBase: 0.028, spreadMove: 0.034, spreadShot: 0.004, spreadMax: 0.08,
    recoilUp: 0.07, recoilSide: 0.01, recoilSnap: 8, recoilRecover: 5,
    kickBack: 0.2, zoom: null,
    model: 'shotgun', vmPos: [0.28, -0.24, -0.52], vmRot: [0, 0, 0], vmScale: 0.8,
  },
  ak47: {
    name: 'AK-47', slot: 'primary', key: 1, price: 2700, auto: true, rpm: 600,
    mag: 30, reserve: 90, reloadMs: 2400,
    dmg: 30, headMul: 3.5, range: 300, killReward: 300,
    spreadBase: 0.0012, spreadMove: 0.012, spreadShot: 0.0035, spreadMax: 0.05,
    recoilUp: 0.0205, recoilSide: 0.011, recoilSnap: 9, recoilRecover: 5.5,
    kickBack: 0.085, zoom: null,
    model: 'ak', vmPos: [0.28, -0.26, -0.55], vmRot: [0, -Math.PI / 2, 0], vmScale: 0.85,
  },
  m4: {
    name: 'M4A4', slot: 'primary', key: 1, price: 3100, auto: true, rpm: 666,
    mag: 30, reserve: 90, reloadMs: 2300,
    dmg: 28, headMul: 3.2, range: 300, killReward: 300,
    spreadBase: 0.001, spreadMove: 0.01, spreadShot: 0.0028, spreadMax: 0.042,
    recoilUp: 0.016, recoilSide: 0.008, recoilSnap: 10, recoilRecover: 6.5,
    kickBack: 0.075, zoom: null,
    model: 'm4', vmPos: [0.28, -0.26, -0.55], vmRot: [0, Math.PI / 2, 0], vmScale: 0.85,
  },
  awp: {
    name: 'AWP', slot: 'primary', key: 1, price: 4750, auto: false, rpm: 50,
    mag: 5, reserve: 20, reloadMs: 3200,
    dmg: 110, headMul: 2.0, range: 500, killReward: 100,
    spreadBase: 0.05, spreadMove: 0.08, spreadShot: 0.01, spreadMax: 0.12,
    spreadScoped: 0.0002,
    recoilUp: 0.055, recoilSide: 0.012, recoilSnap: 6, recoilRecover: 3.5,
    kickBack: 0.22, zoom: 4.2,
    model: 'sniper', vmPos: [0.28, -0.28, -0.62], vmRot: [0, 0, 0], vmScale: 1.1,
  },
};

export const BUY_MENU = {
  'Пистолеты': ['deagle'],
  'СМГ и дробовики': ['mp5', 'shotgun'],
  'Винтовки': ['ak47', 'm4', 'awp'],
};

// ===== Skins (applied as tint to gun meshes) =====
export const SKINS = {
  default: { name: 'Стандарт', tint: null },
  gold: { name: 'Золото', tint: 0xd4af37, metal: 0.85, rough: 0.3 },
  crimson: { name: 'Кровавая паутина', tint: 0x8e1616, metal: 0.3, rough: 0.5 },
  neon: { name: 'Неон', tint: 0x18d8c0, metal: 0.2, rough: 0.35, emissive: 0x06554b },
  arctic: { name: 'Арктика', tint: 0xdfe9f2, metal: 0.45, rough: 0.35 },
  toxic: { name: 'Токсин', tint: 0x53c41a, metal: 0.2, rough: 0.45, emissive: 0x1c4a05 },
  midnight: { name: 'Полночь', tint: 0x232b4a, metal: 0.7, rough: 0.25, emissive: 0x080d22 },
};

export const ECONOMY = {
  start: 800, max: 16000,
  winReward: 3250, loseReward: 1900,
};

export const ROUND = {
  freezeMs: 6000,    // freeze time: can buy, can't move
  liveMs: 105000,    // round timer
  buyMs: 16000,      // can buy during freeze + first 10s of live
  endMs: 7000,       // after round win banner
  winsToFinish: 10,  // match ends at N round wins
  spawnProtectMs: 3000, // warmup spawn protection
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
