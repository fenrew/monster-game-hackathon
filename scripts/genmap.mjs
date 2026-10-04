// Generates data/map.json from data/zones.json.
// Run once with `npm run genmap`; after that map.json is authored data you can hand-edit.
// Re-running overwrites map.json (the output is deterministic for a given SEED).
import fs from 'fs';
import path from 'path';
import url from 'url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const zones = JSON.parse(fs.readFileSync(path.join(root, 'data/zones.json'), 'utf8'));

const W = 40, H = 40, SEED = 20261004;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));

function zoneAt(x, y) {
  for (const z of zones) for (const [rx, ry, rw, rh] of z.rects) {
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return z.id;
  }
  return null;
}

const g = Array.from({ length: H }, () => Array(W).fill('.'));
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const set = (x, y, c) => { if (inb(x, y)) g[y][x] = c; };
const get = (x, y) => (inb(x, y) ? g[y][x] : '#');
const blocked = (c) => 'T^~#*'.includes(c);

// --- base ground ---
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  g[y][x] = zoneAt(x, y) === 'arena' ? ':' : '.';
}

// --- decorate interiors ---
function blob(cx, cy, r, c, onlyZone) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const d = Math.hypot(x - cx, y - cy) + rng() * 0.8;
    if (d <= r && inb(x, y) && (!onlyZone || zoneAt(x, y) === onlyZone)) set(x, y, c);
  }
}
function scatter(zone, c, density) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (zoneAt(x, y) === zone && g[y][x] === '.' && rng() < density) set(x, y, c);
  }
}
function randIn(zone) {
  for (let i = 0; i < 1000; i++) {
    const x = ri(1, W - 2), y = ri(1, H - 2);
    if (zoneAt(x, y) === zone) return [x, y];
  }
  throw new Error('no tile in ' + zone);
}

// Meadow: friendly grass patches, a few trees
for (let i = 0; i < 11; i++) { const [x, y] = randIn('meadow'); blob(x, y, ri(2, 3), ',', 'meadow'); }
scatter('meadow', 'T', 0.03);
// Forest: dense trees, big grass areas
for (let i = 0; i < 12; i++) { const [x, y] = randIn('forest'); blob(x, y, ri(2, 4), ',', 'forest'); }
scatter('forest', 'T', 0.13);
// Marsh: ponds and reeds
for (let i = 0; i < 6; i++) { const [x, y] = randIn('marsh'); blob(x, y, ri(1, 2), '~', 'marsh'); }
for (let i = 0; i < 12; i++) { const [x, y] = randIn('marsh'); blob(x, y, ri(2, 3), ',', 'marsh'); }
scatter('marsh', 'T', 0.03);
// Cave: rock pillars and crystals (every tile is an encounter hotspot)
scatter('cave', '^', 0.09);
scatter('cave', '*', 0.04);

// --- borders ---
for (let x = 0; x < W; x++) { set(x, 0, edge(x, 0)); set(x, H - 1, edge(x, H - 1)); }
for (let y = 0; y < H; y++) { set(0, y, edge(0, y)); set(W - 1, y, edge(W - 1, y)); }
function edge(x, y) {
  const z = zoneAt(x, y);
  return z === 'arena' || z === 'town' ? '#' : z === 'cave' ? '^' : 'T';
}
// Arena walls (no entrance: bosses teleport everyone in)
for (let y = 0; y <= 9; y++) set(11, y, '#');
for (let x = 0; x <= 11; x++) set(x, 9, '#');
// Forest | Meadow  (gap x 8-10)
for (let x = 0; x <= 19; x++) set(x, 23, x >= 8 && x <= 10 ? '.' : 'T');
// Marsh | Meadow (gap x 30-32)
for (let x = 20; x <= 39; x++) set(x, 23, x >= 30 && x <= 32 ? '.' : '~');
// Forest | Marsh (gap y 16-17)
for (let y = 12; y <= 22; y++) set(20, y, y >= 16 && y <= 17 ? '.' : 'T');
// Forest | Cave (closed)
for (let y = 0; y <= 11; y++) set(20, y, '^');
// Marsh | Cave (gap x 33-35)
for (let x = 20; x <= 39; x++) set(x, 11, x >= 33 && x <= 35 ? '.' : '^');
// Town fence with north, west and east gates
for (let x = 14; x <= 25; x++) { set(x, 28, x === 19 || x === 20 ? '=' : '#'); set(x, 39, '#'); }
for (let y = 28; y <= 39; y++) {
  set(14, y, y === 33 || y === 34 ? '=' : '#');
  set(25, y, y === 33 || y === 34 ? '=' : '#');
}
// Town interior
for (let y = 29; y <= 38; y++) for (let x = 15; x <= 24; x++) set(x, y, '.');

// --- paths ---
function carve(x, y) {
  const z = zoneAt(x, y);
  const c = get(x, y);
  if (z === 'cave') { if (blocked(c)) set(x, y, '.'); return; }
  set(x, y, z === 'meadow' || z === 'town' ? '=' : '.');
}
function line(x0, y0, x1, y1) {
  // horizontal first, then vertical
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  carve(x, y);
  while (x !== x1) { x += sx; carve(x, y); }
  while (y !== y1) { y += sy; carve(x, y); }
}
function vline(x, y0, y1) { line(x, y0, x, y1); }
function hline(y, x0, x1) { line(x0, y, x1, y); }

// town plaza cross
vline(19, 28, 34); vline(20, 28, 34);
hline(33, 14, 25); hline(34, 14, 25);
// north gate -> meadow junction
vline(19, 25, 28); vline(20, 25, 28);
hline(25, 9, 31);
vline(9, 25, 23); vline(31, 25, 23);
// west / east gates
hline(33, 9, 14); vline(9, 33, 25);
hline(33, 25, 31); vline(31, 33, 25);
// forest trail to the marsh gap
vline(9, 23, 16); hline(16, 9, 21); hline(17, 19, 21);
// marsh trail from meadow gap, to forest gap, to the cave
vline(31, 23, 16); hline(16, 21, 34); vline(34, 16, 11);
// a short corridor into the cave
vline(34, 11, 6);

// --- objects ---
const objects = [
  { type: 'spawn', x: 19, y: 33 },
  { type: 'heal', x: 16, y: 30 },
  { type: 'shop', x: 23, y: 30 },
  { type: 'fusion', x: 23, y: 32 },
  { type: 'portal', x: 16, y: 32 },
  { type: 'npc', id: 'elder', x: 16, y: 36 },
  { type: 'npc', id: 'ranger', x: 23, y: 36 },
  { type: 'npc', id: 'sage', x: 20, y: 37 },
  { type: 'arenaSpawn', x: 5, y: 6 },
  { type: 'bossSpot', x: 5, y: 2 },
  // signs describe the zone you are about to enter
  { type: 'sign', zone: 'meadow', x: 18, y: 27 },
  { type: 'sign', zone: 'meadow', x: 13, y: 32 },
  { type: 'sign', zone: 'meadow', x: 26, y: 32 },
  { type: 'sign', zone: 'forest', x: 7, y: 24 },
  { type: 'sign', zone: 'meadow', x: 7, y: 22 },
  { type: 'sign', zone: 'marsh', x: 29, y: 24 },
  { type: 'sign', zone: 'meadow', x: 29, y: 22 },
  { type: 'sign', zone: 'marsh', x: 19, y: 15 },
  { type: 'sign', zone: 'forest', x: 21, y: 15 },
  { type: 'sign', zone: 'cave', x: 32, y: 12 },
  { type: 'sign', zone: 'marsh', x: 32, y: 10 },
  // trainers (details in data/trainers.json)
  { type: 'trainer', id: 'pip', x: 4, y: 30 },
  { type: 'trainer', id: 'mira', x: 35, y: 30 },
  { type: 'trainer', id: 'rook', x: 14, y: 13 },
  { type: 'trainer', id: 'moss', x: 12, y: 18 },
  { type: 'trainer', id: 'gil', x: 27, y: 13 },
  { type: 'trainer', id: 'vera', x: 37, y: 8 },
];
for (const o of objects) {
  if (['arenaSpawn', 'bossSpot', 'spawn', 'portal'].includes(o.type)) continue;
  if (zoneAt(o.x, o.y) === 'town') set(o.x, o.y, '.');
  else if (blocked(get(o.x, o.y)) || get(o.x, o.y) === ',') set(o.x, o.y, '.');
}
const objectBlocks = new Set(objects.filter((o) => ['heal', 'shop', 'fusion', 'npc', 'sign', 'trainer'].includes(o.type)).map((o) => o.x + ',' + o.y));

// --- connectivity: anything not reachable from spawn becomes a wall ---
const seen = new Set();
const q = [[19, 33]];
seen.add('19,33');
while (q.length) {
  const [x, y] = q.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
    if (!inb(nx, ny) || seen.has(k) || blocked(get(nx, ny)) || objectBlocks.has(k)) continue;
    seen.add(k); q.push([nx, ny]);
  }
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const z = zoneAt(x, y);
  if (z === 'arena' || blocked(g[y][x]) || objectBlocks.has(x + ',' + y)) continue;
  if (!seen.has(x + ',' + y)) set(x, y, z === 'cave' ? '^' : 'T');
}

const out = {
  width: W, height: H, tileSize: 32,
  legend: {
    '.': { name: 'ground', walkable: true },
    ',': { name: 'tall grass', walkable: true, grass: true },
    '=': { name: 'path', walkable: true },
    ':': { name: 'arena floor', walkable: true },
    'T': { name: 'tree', walkable: false },
    '^': { name: 'rock', walkable: false },
    '~': { name: 'water', walkable: false },
    '#': { name: 'wall', walkable: false },
    '*': { name: 'crystal', walkable: false },
  },
  rows: g.map((r) => r.join('')),
  objects,
};
// Hand-format so each map row and object sits on one line (easy to edit by hand).
const json = [
  '{',
  `  "width": ${W}, "height": ${H}, "tileSize": 32,`,
  '  "legend": {',
  Object.entries(out.legend).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n'),
  '  },',
  '  "rows": [',
  out.rows.map((r) => '    ' + JSON.stringify(r)).join(',\n'),
  '  ],',
  '  "objects": [',
  out.objects.map((o) => '    ' + JSON.stringify(o)).join(',\n'),
  '  ]',
  '}',
].join('\n');
fs.writeFileSync(path.join(root, 'data/map.json'), json + '\n');
console.log(out.rows.join('\n'));
