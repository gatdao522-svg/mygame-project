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

const maps = { arena, dust: dust, yard };
const out = path.join(__dirname, '..', 'public', 'maps.json');
fs.writeFileSync(out, JSON.stringify(maps));
console.log('wrote', out, Object.keys(maps).map((k) => `${k}(${maps[k].walls.length}w/${maps[k].crates.length}c)`).join(' '));
