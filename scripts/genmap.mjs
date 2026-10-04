// Generates data/map.json from data/zones.json.
// Run once with `npm run genmap`; after that map.json is authored data you can hand-edit.
// Re-running overwrites map.json (the output is deterministic for a given SEED).
//
// Layout: the original 40x40 starting region (top-left) is generated exactly as before, then the
// frontier is added to the east and south. The only way out of the starting region is the east gate,
// which Warden Holt opens per player once they finish the "frontier_pass" quest.
import fs from 'fs';
import path from 'path';
import url from 'url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const allZones = JSON.parse(fs.readFileSync(path.join(root, 'data/zones.json'), 'utf8'));
// Gym buildings are stamped on top of the finished terrain, so terrain generation ignores their zones.
const zones = allZones.filter((z) => !z.id.startsWith('gym_'));

const W = 80, H = 60, SEED = 20261004;
const OLD = 40; // size of the original starting region

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
const zoneRect = (id) => zones.find((z) => z.id === id).rects[0];

const g = Array.from({ length: H }, () => Array(W).fill('.'));
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const set = (x, y, c) => { if (inb(x, y)) g[y][x] = c; };
const get = (x, y) => (inb(x, y) ? g[y][x] : '#');
const blocked = (c) => 'T^~#*%'.includes(c);

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
/** Random tile in a zone. Starting-region zones keep the original 40x40 search box so their layout is unchanged. */
function randIn(zone) {
  const [rx, ry, rw, rh] = zoneRect(zone);
  const old = rx < OLD && ry < OLD;
  for (let i = 0; i < 1000; i++) {
    const x = old ? ri(1, OLD - 2) : ri(rx + 1, rx + rw - 2);
    const y = old ? ri(1, OLD - 2) : ri(ry + 1, ry + rh - 2);
    if (zoneAt(x, y) === zone) return [x, y];
  }
  throw new Error('no tile in ' + zone);
}

// ===================================================================== starting region (unchanged)
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

// --- borders of the starting region ---
function edge(x, y) {
  const z = zoneAt(x, y);
  return z === 'arena' || z === 'town' ? '#' : z === 'cave' || z === 'peaks' || z === 'ruins' || z === 'wastes' ? '^' : 'T';
}
for (let x = 0; x < OLD; x++) { set(x, 0, edge(x, 0)); set(x, OLD - 1, edge(x, OLD - 1)); }
for (let y = 0; y < OLD; y++) { set(0, y, edge(0, y)); set(OLD - 1, y, edge(OLD - 1, y)); }
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
const PATH_ZONES = new Set(['meadow', 'town', 'steppe', 'outpost']);
function carve(x, y) {
  const z = zoneAt(x, y);
  const c = get(x, y);
  if (z === 'cave' || z === 'ruins') { if (blocked(c)) set(x, y, '.'); return; }
  set(x, y, PATH_ZONES.has(z) ? '=' : '.');
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

// ===================================================================== frontier
// Steppe: golden grassland
for (let i = 0; i < 16; i++) { const [x, y] = randIn('steppe'); blob(x, y, ri(2, 4), ',', 'steppe'); }
scatter('steppe', '^', 0.025);
scatter('steppe', 'T', 0.03);
// Peaks: rocky highlands with alpine grass
for (let i = 0; i < 12; i++) { const [x, y] = randIn('peaks'); blob(x, y, ri(2, 3), ',', 'peaks'); }
scatter('peaks', '^', 0.13);
scatter('peaks', 'T', 0.04);
// Ruins: flooded halls, every tile a hotspot
for (let i = 0; i < 7; i++) { const [x, y] = randIn('ruins'); blob(x, y, ri(1, 2), '~', 'ruins'); }
scatter('ruins', '^', 0.08);
// Wastes: ash grass, lava pools, obsidian
for (let i = 0; i < 12; i++) { const [x, y] = randIn('wastes'); blob(x, y, ri(2, 3), ',', 'wastes'); }
for (let i = 0; i < 8; i++) { const [x, y] = randIn('wastes'); blob(x, y, ri(1, 2), '%', 'wastes'); }
scatter('wastes', '^', 0.07);

// outer border of the whole map
for (let x = OLD; x < W; x++) { set(x, 0, edge(x, 0)); set(x, H - 1, edge(x, H - 1)); }
for (let y = OLD; y < H; y++) { set(0, y, edge(0, y)); }
for (let y = 0; y < H; y++) set(W - 1, y, edge(W - 1, y));
for (let x = 0; x < OLD; x++) set(x, H - 1, edge(x, H - 1));
// Starting region | Steppe: the warden's gate (opened per player by quest)
set(OLD - 1, 31, '.'); set(OLD - 1, 32, '.');
// Steppe | Peaks (gap x 60-62)
for (let x = 40; x < W - 1; x++) set(x, 20, x >= 60 && x <= 62 ? '.' : 'T');
// Steppe | Wastes (gap x 66-68)
for (let x = 40; x < W - 1; x++) set(x, 39, x >= 66 && x <= 68 ? '.' : '^');
// Wastes | Ruins (gap y 49-50)
for (let y = 40; y < H - 1; y++) set(40, y, y >= 49 && y <= 50 ? '.' : '^');
// Ruins top wall under the starting region
for (let x = 0; x < OLD; x++) set(x, 40, '^');
// Frontier Outpost: palisade with west, north and south gates
{
  const [ox, oy, ow, oh] = zoneRect('outpost');
  for (let y = oy; y < oy + oh; y++) for (let x = ox; x < ox + ow; x++) {
    const edgeTile = x === ox || x === ox + ow - 1 || y === oy || y === oy + oh - 1;
    set(x, y, edgeTile ? '#' : '.');
  }
}

// frontier paths
hline(31, 39, 44); hline(32, 39, 44);           // gate -> outpost west gate
vline(48, 28, 35); vline(49, 28, 35);           // outpost cross
hline(31, 44, 53); hline(32, 44, 52);
vline(48, 27, 24); hline(24, 48, 61); vline(61, 24, 16);   // north gate -> peaks
vline(48, 36, 37); hline(37, 48, 67); vline(67, 37, 49);   // south gate -> wastes
hline(49, 67, 20);                                            // wastes -> ruins
hline(50, 41, 39);

// Champion's Throne: the final challenge in the far south-east corner
{
  const [tx, ty, tw, th] = zoneRect('throne');
  for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) set(x, y, '.');
  for (let x = tx; x < tx + tw; x++) set(x, ty, '^');                                   // back wall
  for (let y = ty; y < ty + th; y++) set(tx, y, y === ty + 3 || y === ty + 4 ? '.' : '^'); // west wall with an entrance
  for (const [px, py] of [[tx + 1, ty + 1], [tx + tw - 2, ty + 1], [tx + 1, ty + th - 2], [tx + tw - 2, ty + th - 2]]) set(px, py, '^');
}
vline(67, 49, 54); hline(54, 67, 70); hline(55, 67, 70);

// Gyms: walled halls with a themed floor; gym trainers guard the way to the Leader at the back
function gym(id, doors, decor, deco) {
  const [gx, gy, gw, gh] = allZones.find((z) => z.id === id).rects[0];
  for (let y = gy; y < gy + gh; y++) for (let x = gx; x < gx + gw; x++) {
    set(x, y, x === gx || y === gy || x === gx + gw - 1 || y === gy + gh - 1 ? '#' : '.');
  }
  for (const [x, y] of doors) set(x, y, '.');
  for (const [x, y] of decor) set(x, y, deco);
}
gym('gym_stone', [[8, 33], [8, 34]], [[2, 32], [7, 37], [2, 37]], '^');
hline(34, 8, 9);
gym('gym_spark', [[70, 28], [70, 29]], [[71, 26], [71, 30], [77, 26], [77, 30]], '*');
vline(61, 24, 24); hline(24, 61, 66); vline(66, 24, 29); hline(28, 66, 70); hline(29, 66, 70);
gym('gym_tide', [[8, 50]], [[5, 51], [11, 51], [5, 56], [11, 56]], '~');
hline(49, 20, 8); vline(8, 49, 50);

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
  // the frontier gate and its warden
  { type: 'gate', x: 39, y: 31, quest: 'frontier_pass' },
  { type: 'gate', x: 39, y: 32, quest: 'frontier_pass' },
  { type: 'npc', id: 'warden', x: 38, y: 30 },
  { type: 'sign', zone: 'steppe', x: 37, y: 34 },
  // Frontier Outpost
  { type: 'outpostSpawn', x: 50, y: 31 },
  { type: 'heal', x: 45, y: 29 },
  { type: 'shop', x: 52, y: 29 },
  { type: 'fusion', x: 45, y: 34 },
  { type: 'portal', x: 52, y: 34 },
  { type: 'npc', id: 'scout', x: 51, y: 30 },
  // frontier signs
  { type: 'sign', zone: 'peaks', x: 59, y: 21 },
  { type: 'sign', zone: 'steppe', x: 59, y: 19 },
  { type: 'sign', zone: 'wastes', x: 65, y: 38 },
  { type: 'sign', zone: 'steppe', x: 65, y: 40 },
  { type: 'sign', zone: 'ruins', x: 41, y: 48 },
  { type: 'sign', zone: 'wastes', x: 39, y: 48 },
  // frontier trainers
  { type: 'trainer', id: 'dell', x: 56, y: 22 },
  { type: 'trainer', id: 'sol', x: 64, y: 15 },
  { type: 'trainer', id: 'nim', x: 28, y: 46 },
  { type: 'trainer', id: 'kael', x: 70, y: 45 },
  // the elite trainer: beating her wins the run
  { type: 'trainer', id: 'aurelia', x: 74, y: 53 },
  { type: 'sign', zone: 'throne', x: 68, y: 53 },
  // gyms: gym trainers, then the Leader who hands out the badge
  { type: 'trainer', id: 'tess', x: 5, y: 37 },
  { type: 'trainer', id: 'brannoc', x: 2, y: 34 },
  { type: 'sign', zone: 'gym_stone', x: 10, y: 35 },
  { type: 'trainer', id: 'watt', x: 74, y: 26 },
  { type: 'trainer', id: 'zara', x: 77, y: 28 },
  { type: 'sign', zone: 'gym_spark', x: 67, y: 30 },
  { type: 'trainer', id: 'coral', x: 5, y: 53 },
  { type: 'trainer', id: 'reef', x: 11, y: 55 },
  { type: 'trainer', id: 'marina', x: 8, y: 56 },
  { type: 'sign', zone: 'gym_tide', x: 10, y: 48 },
];
const trainers = JSON.parse(fs.readFileSync(path.join(root, 'data/trainers.json'), 'utf8'));
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
for (const o of objects) {
  if (['arenaSpawn', 'bossSpot', 'spawn', 'portal', 'outpostSpawn', 'gate'].includes(o.type)) continue;
  if (zoneAt(o.x, o.y) === 'town' || zoneAt(o.x, o.y) === 'outpost') set(o.x, o.y, '.');
  else if (blocked(get(o.x, o.y)) || get(o.x, o.y) === ',') set(o.x, o.y, '.');
  // keep frontier trainers' lines of sight open
  if (o.type === 'trainer' && (o.x >= OLD || o.y >= OLD)) {
    const t = trainers[o.id];
    const [dx, dy] = DIRS[t.facing];
    for (let i = 1; i <= t.sight; i++) if (blocked(get(o.x + dx * i, o.y + dy * i))) set(o.x + dx * i, o.y + dy * i, '.');
  }
}
for (const o of objects) if (o.type === 'portal' || o.type === 'outpostSpawn') set(o.x, o.y, get(o.x, o.y) === '=' ? '=' : '.');
const objectBlocks = new Set(objects.filter((o) => ['heal', 'shop', 'fusion', 'npc', 'sign', 'trainer'].includes(o.type)).map((o) => o.x + ',' + o.y));

// --- connectivity: anything not reachable from spawn becomes a wall (gates count as open) ---
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
  if (!seen.has(x + ',' + y)) set(x, y, ['cave', 'peaks', 'ruins', 'wastes'].includes(z) ? '^' : 'T');
}

const out = {
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
    '%': { name: 'lava', walkable: false },
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
