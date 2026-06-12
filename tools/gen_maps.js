#!/usr/bin/env node
// Generates public/maps.json — fully expanded map data for client AND server.
// walls/lows: [cx, cz, w, d, h]  crates: [x, z, size, stack]
// platforms: [cx, cz, w, d, h, stairDir]  spawns: [x, y, z]
const fs = require('fs');
const path = require('path');

const mirror = (e) => [-e[0], -e[1], ...e.slice(2)];
function expand(sym) { const out = []; for (const e of sym) out.push(e, mirror(e)); return out; }
function expandPlat(sym) {
  const out = [];
  for (const p of sym) out.push(p, [-p[0], -p[1], p[2], p[3], p[4], p[5] === 'E' ? 'W' : 'E']);
  return out;
}

// ================= de_arena (original) =================
const arena = {
  label: 'de_arena',
  size: [100, 80],
  walls: [
    [0, -38.5, 98, 1, 8], [0, 38.5, 98, 1, 8],
    [-48.5, 0, 1, 78, 8], [48.5, 0, 1, 78, 8],
    ...expand([
      [-8, -27, 1, 22, 6],
      [-8, -1, 1, 14, 6],
      [-5.5, 0, 5, 1, 6],
      [-24, 0, 32, 28, 7],
    ]),
  ],
  lows: expand([
    [0, 12, 6, 0.4, 1.15],
    [-24, -20, 0.5, 6, 2.2],
    [-44.5, 14.5, 7, 0.4, 1.15],
  ]),
  crates: expand([
    [-30, -25, 1.6, 2], [-28.2, -26.5, 1.6, 1], [-31.8, -23.2, 1.6, 1],
    [-26, -32, 2.2, 1], [-14, -19, 1.6, 1], [-36, -18, 1.6, 1],
    [-6.6, 2.8, 1.4, 1],
    [-44, -4, 1.7, 1],
    [-22, 20, 1.8, 1], [-38, 33, 1.6, 1],
  ]),
  platforms: expandPlat([[-16, -34, 8, 8, 2.0, 'E']]),
  sites: [['B', -30, -25], ['A', 30, 25]],
  spawns: {
    t: [[-34, 0, 26], [-30, 0, 30], [-26, 0, 26], [-30, 0, 22], [-36, 0, 30], [-40, 0, 26], [-26, 0, 33], [-34, 0, 33]],
    ct: [[34, 0, -26], [30, 0, -30], [26, 0, -26], [30, 0, -22], [36, 0, -30], [40, 0, -26], [26, 0, -33], [34, 0, -33]],
  },
  palette: {
    floor: '#bfae84', wall: '#cdb98f', crate: '#8d6b40',
    fog: '#d8cba8', skyTop: [0.36, 0.56, 0.83], skyHor: [0.87, 0.8, 0.66],
    hemiSky: '#cfe2ff', hemiGround: '#b09a6e', sun: '#fff2d8',
  },
};

// ================= de_dust_mini =================
// Dust2-inspired, 180° symmetric: T spawn S, CT spawn N.
// Long corridors east/west, central plaza with double doors, tunnels through buildings.
const dust = {
  label: 'de_dust_mini',
  size: [110, 90],
  walls: [
    // perimeter
    [0, -43.5, 108, 1, 9], [0, 43.5, 108, 1, 9],
    [-53.5, 0, 1, 88, 9], [53.5, 0, 1, 88, 9],
    ...expand([
      // central building block west of mid (with tunnel gap z[-6..0])
      [-22, -14, 26, 20, 8],            // big block NW
      [-22, 10.5, 26, 11, 8],           // block SW (tunnel between them z[-4..5] => gap)
      // mid walls forming double-door choke at x=0
      [-3.5, -2, 6, 1, 7],              // door stub west (gap x[-0.5..0.5]? keep 3 wide: stubs at ±3.5 w6 => gap x[-0.5,0.5]... widen)
      // long corridor inner wall (east side)
      [38, -8, 1, 56, 7],               // long A corridor wall: x=38 z[-36..20]
      // site B walls (NW plaza partly enclosed)
      [-40, -28, 16, 1, 6],
    ]),
  ],
  lows: expand([
    [0, 16, 7, 0.5, 1.2],      // mid cover south
    [-34, -34, 0.5, 7, 2.0],   // B site side cover
    [46, -16, 6, 0.5, 1.2],    // long corridor cover
  ]),
  crates: expand([
    // B site NW
    [-42, -36, 1.8, 2], [-39.8, -37.5, 1.8, 1], [-44, -33.5, 1.8, 1],
    [-30, -38, 2.4, 1], [-16, -30, 1.7, 1],
    // tunnels exit
    [-36, -2, 1.6, 1],
    // mid
    [-4.5, 4.5, 1.5, 1], [3, -7, 1.5, 2],
    // long corridor
    [44, 6, 1.8, 1], [49, -28, 1.7, 1],
    // T spawn cover
    [-24, 32, 1.8, 1], [-10, 38, 1.6, 1],
  ]),
  platforms: expandPlat([[-47, -39, 9, 7, 2.2, 'E']]),
  sites: [['B', -42, -36], ['A', 42, 36]],
  spawns: {
    t: [[-6, 0, 36], [-12, 0, 38], [0, 0, 38], [-18, 0, 36], [6, 0, 38], [-24, 0, 38], [12, 0, 36], [-6, 0, 40]],
    ct: [[6, 0, -36], [12, 0, -38], [0, 0, -38], [18, 0, -36], [-6, 0, -38], [24, 0, -38], [-12, 0, -36], [6, 0, -40]],
  },
  palette: {
    floor: '#c9a96a', wall: '#d6b87f', crate: '#96703f',
    fog: '#e3cfa0', skyTop: [0.42, 0.62, 0.85], skyHor: [0.93, 0.84, 0.65],
    hemiSky: '#d6e6ff', hemiGround: '#bd9f68', sun: '#ffefcf',
  },
};

// ================= aim_yard (small, fast) =================
const yard = {
  label: 'aim_yard',
  size: [64, 48],
  walls: [
    [0, -22.5, 62, 1, 7], [0, 22.5, 62, 1, 7],
    [-30.5, 0, 1, 46, 7], [30.5, 0, 1, 46, 7],
    ...expand([
      [-14, -10, 10, 1, 4],   // side wall chunks
    ]),
  ],
  lows: expand([
    [0, 6, 8, 0.5, 1.15],
    [-9, -3, 0.5, 6, 1.3],
    [-20, 9, 5, 0.5, 1.15],
  ]),
  crates: expand([
    [0, 0, 2.0, 2],
    [-4, 1.5, 1.7, 1], [4, -3, 1.7, 1],
    [-16, -14, 1.8, 2], [-22, -4, 1.6, 1],
    [-12, 14, 1.7, 1],
  ]),
  platforms: [],
  sites: [],
  spawns: {
    t: [[-25, 0, 16], [-21, 0, 18], [-25, 0, 12], [-17, 0, 16], [-21, 0, 13], [-25, 0, 19], [-17, 0, 19], [-13, 0, 17]],
    ct: [[25, 0, -16], [21, 0, -18], [25, 0, -12], [17, 0, -16], [21, 0, -13], [25, 0, -19], [17, 0, -19], [13, 0, -17]],
  },
  palette: {
    floor: '#9aa0a6', wall: '#aab2b8', crate: '#8d6b40',
    fog: '#c2cbd2', skyTop: [0.3, 0.45, 0.68], skyHor: [0.78, 0.8, 0.82],
    hemiSky: '#dce8f5', hemiGround: '#8e9298', sun: '#f5f0e0',
  },
};


// ================= de_village (big map with enterable houses) =================
// Walls support optional 6th element y0 (vertical offset) — used for door
// lintels, window openings and roof slabs. Houses are fully enterable;
// some roofs are reachable via exterior stairs (platforms).

const T = 0.5; // house wall thickness
/**
 * Generates wall entries for an axis-aligned house with door/window openings
 * and a walkable roof. side: 'N'(-z) 'S'(+z) 'W'(-x) 'E'(+x); off = offset
 * along the wall from its center.
 */
function house(cx, cz, w, d, h, { doors = [], windows = [], parapet = false } = {}) {
  const out = [];
  const sideDef = {
    N: { horiz: true, line: cz - (d - T) / 2, span: w },
    S: { horiz: true, line: cz + (d - T) / 2, span: w },
    W: { horiz: false, line: cx - (w - T) / 2, span: d },
    E: { horiz: false, line: cx + (w - T) / 2, span: d },
  };
  const seg = (sd, segCenterOff, segLen, segH, y0 = 0) => {
    if (segLen <= 0.05 || segH <= 0.05) return;
    const c = sd.horiz ? cx + segCenterOff : cz + segCenterOff;
    out.push(sd.horiz ? [c, sd.line, segLen, T, segH, y0] : [sd.line, c, T, segLen, segH, y0]);
  };
  for (const sideName of ['N', 'S', 'W', 'E']) {
    const sd = sideDef[sideName];
    const ops = [];
    for (const dr of doors) if (dr.side === sideName) ops.push({ off: dr.off || 0, w: 1.9, kind: 'door' });
    for (const wn of windows) if (wn.side === sideName) ops.push({ off: wn.off || 0, w: 1.7, kind: 'win' });
    ops.sort((a, b) => a.off - b.off);
    let cursor = -sd.span / 2;
    for (const op of ops) {
      const lo = op.off - op.w / 2, hi = op.off + op.w / 2;
      seg(sd, (cursor + lo) / 2, lo - cursor, h); // full-height piece before opening
      if (op.kind === 'door') {
        seg(sd, op.off, op.w, h - 2.3, 2.3); // lintel
      } else {
        seg(sd, op.off, op.w, 1.0);          // sill (cover when crouched)
        seg(sd, op.off, op.w, h - 2.1, 2.1); // lintel
      }
      cursor = hi;
    }
    seg(sd, (cursor + sd.span / 2) / 2, sd.span / 2 - cursor, h);
  }
  out.push([cx, cz, w, d, 0.35, h]); // walkable roof slab
  if (parapet) { // parapet = array of sides (omit the side where stairs arrive)
    const ph = 0.7, py = h + 0.35;
    if (parapet.includes('N')) out.push([cx, cz - (d - T) / 2, w, T, ph, py]);
    if (parapet.includes('S')) out.push([cx, cz + (d - T) / 2, w, T, ph, py]);
    if (parapet.includes('W')) out.push([cx - (w - T) / 2, cz, T, d, ph, py]);
    if (parapet.includes('E')) out.push([cx + (w - T) / 2, cz, T, d, ph, py]);
  }
  return out;
}
const mirrorWalls = (entries) => entries.map((e) => [-e[0], -e[1], ...e.slice(2)]);

// Layout: 150x130. CT spawn north (-z), T spawn south (+z). 180° symmetric.
// Central house-tunnel at mid, A site NE courtyard, B site SW courtyard.
const vHousesHalf = [
  // big site house next to A (roof reachable via stairs, overlooks the site)
  ...house(38, -20, 14, 12, 5, {
    doors: [{ side: 'W', off: 0 }, { side: 'S', off: -3 }],
    windows: [{ side: 'N', off: -3 }, { side: 'N', off: 3 }, { side: 'E', off: 0 }],
    parapet: ['N', 'S', 'W'],
  }),
  // long row house along mid street (east side)
  ...house(14, -36, 12, 9, 4.5, {
    doors: [{ side: 'S', off: 0 }, { side: 'W', off: 0 }],
    windows: [{ side: 'N', off: 0 }, { side: 'E', off: 0 }],
  }),
  // small shed near CT side
  ...house(-16, -44, 8, 7, 3.8, {
    doors: [{ side: 'E', off: 0 }],
    windows: [{ side: 'S', off: 0 }],
  }),
  // mid-west flank house
  ...house(-34, -8, 10, 9, 4.2, {
    doors: [{ side: 'N', off: 0 }, { side: 'E', off: 0 }],
    windows: [{ side: 'S', off: 0 }, { side: 'W', off: 0 }],
  }),
];

const village = {
  label: 'de_village',
  size: [150, 130],
  walls: [
    // perimeter
    [0, -63.5, 148, 1, 9], [0, 63.5, 148, 1, 9],
    [-73.5, 0, 1, 126, 9], [73.5, 0, 1, 126, 9],
    // central house-tunnel (self-mirrored, sits exactly at center)
    ...house(0, 0, 18, 11, 5, {
      doors: [{ side: 'E', off: 0 }, { side: 'W', off: 0 }, { side: 'N', off: -5 }, { side: 'S', off: 5 }],
      windows: [{ side: 'N', off: 4 }, { side: 'S', off: -4 }],
    }),
    ...vHousesHalf, ...mirrorWalls(vHousesHalf),
    // lane walls shaping routes (mirrored)
    ...expand([
      [-12, -22, 26, 1, 5],   // wall north of B lane
      [-52, -26, 1, 30, 6],   // west alley wall
      [24, -8, 1, 16, 5],     // mid-east divider
    ]),
  ],
  lows: expand([
    [0, 18, 8, 0.5, 1.15],     // mid street cover
    [-38, 22, 6, 0.5, 1.2],    // B approach cover
    [-58, 0, 0.5, 8, 1.3],     // west alley cover
    [30, -34, 6, 0.5, 1.15],   // A long cover
    [12, -14, 0.5, 6, 1.2],
  ]),
  crates: expand([
    [-38, 18, 1.8, 2], [-40.2, 16, 1.6, 1], [-36, 20.4, 1.6, 1], // B site stack
    [-30, 28, 1.7, 1], [-46, 26, 1.6, 1],
    [4, 26, 1.7, 1], [-4, 30, 1.6, 2],
    [56, -10, 1.8, 1], [60, -14, 1.6, 1],
    [20, -52, 1.7, 1], [14, -56, 1.6, 1],
    [-62, -38, 1.8, 2],
  ]),
  // stairs up to the A house roof (and mirrored B side)
  platforms: expandPlat([[47.3, -20, 5, 6, 4.9, 'E']]),
  sites: [['A', 38, -32], ['B', -38, 32]],
  spawns: {
    t: [[-8, 0, 54], [-4, 0, 57], [0, 0, 54], [4, 0, 57], [8, 0, 54], [-12, 0, 57], [12, 0, 57], [0, 0, 59]],
    ct: [[8, 0, -54], [4, 0, -57], [0, 0, -54], [-4, 0, -57], [-8, 0, -54], [12, 0, -57], [-12, 0, -57], [0, 0, -59]],
  },
  palette: {
    floor: '#a8a27e', wall: '#c7b294', crate: '#8d6b40',
    fog: '#d3c9ae', skyTop: [0.34, 0.52, 0.78], skyHor: [0.86, 0.81, 0.69],
    hemiSky: '#d6e6ff', hemiGround: '#a59873', sun: '#fff0d2',
  },
};

const maps = { arena, dust: dust, yard, village };
const out = path.join(__dirname, '..', 'public', 'maps.json');
fs.writeFileSync(out, JSON.stringify(maps));
console.log('wrote', out, Object.keys(maps).map((k) => `${k}(${maps[k].walls.length}w/${maps[k].crates.length}c)`).join(' '));
