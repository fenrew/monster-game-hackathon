import Phaser from 'phaser';
import type { MapObject, WorldPlayer, ZoneDef } from '../../shared/types';
import { recommendedLabel, zoneLevelLabel } from '../../shared/map';
import { gymOfLeader } from '../../shared/augments';
import { isTyping } from './dom';
import { net } from './net';
import { portraitFor, store } from './state';

const T = 32;
const col = (hex: string) => parseInt(hex.replace('#', ''), 16);
function shade(c: number, amt: number): number {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}
/** Deterministic per-tile noise, so decoration is stable across reloads. */
function rnd(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  fontSize: '11px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 3,
};
const BLOCKING_TILES = 'T^#*';
const PINE_ZONES = new Set(['forest', 'peaks']);
const FOLLOWER_SIZE = 38;

interface Avatar {
  c: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  isMe: boolean;
  color: string;
  tx: number;
  ty: number;
  tileX: number;
  tileY: number;
  state: string;
  connected: boolean;
  facing: [number, number];
  walkUntil: number;
  frame: number;
  follower: Phaser.GameObjects.Image | null;
  followerShadow: Phaser.GameObjects.Ellipse | null;
  followerSpecies: string | null; // species + tier key
  fx: number; // follower target (world px)
  fy: number;
}

type Ambient = 'pollen' | 'firefly' | 'sparkle' | 'wind' | 'ember';
const ZONE_AMBIENT: Record<string, Ambient> = {
  meadow: 'pollen', steppe: 'pollen', town: 'pollen', outpost: 'pollen',
  forest: 'firefly', marsh: 'firefly',
  cave: 'sparkle', ruins: 'sparkle',
  peaks: 'wind',
  wastes: 'ember', arena: 'ember',
};

export class WorldScene extends Phaser.Scene {
  private me!: Avatar;
  private others = new Map<string, Avatar>();
  private markers = new Map<string, { c: Phaser.GameObjects.Container; ring: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private npcBubbles = new Map<string, Phaser.GameObjects.Text>();
  private trainers = new Map<string, { c: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text }>();
  private portals: { g: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }[] = [];
  private gates: { g: Phaser.GameObjects.Graphics; o: MapObject }[] = [];
  private gateOpen: boolean | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private nextStepAt = 0;
  private lastZone = '';
  private lastGateToast = 0;
  private ambient = new Map<Ambient, Phaser.GameObjects.Particles.ParticleEmitter>();
  private ambientZone = new Phaser.Geom.Rectangle(0, 0, 800, 600);
  private leaves!: Phaser.GameObjects.Particles.ParticleEmitter;
  private texWaiting = new Map<string, (() => void)[]>();

  constructor() {
    super('world');
  }

  create() {
    const { map } = store;
    this.cameras.main.setBackgroundColor('#101418');
    this.makeTextures();
    this.drawMap();
    this.animateLiquids();
    this.drawObjects();
    this.makeAmbient();

    this.me = this.makeAvatar(store.self?.name ?? 'You', '#ffffff', true);
    this.placeMe(true);
    this.cameras.main.setBounds(0, 0, map.width * T, map.height * T);
    this.cameras.main.startFollow(this.me.c, true, 0.2, 0.2);
    this.fitZoom();
    this.scale.on('resize', () => this.fitZoom());

    // enableCapture=false so typing in DOM inputs (chat, names) still works
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    this.textures.on('addtexture', (key: string) => {
      for (const cb of this.texWaiting.get(key) ?? []) cb();
      this.texWaiting.delete(key);
    });

    store.on('pos', (teleport: boolean) => this.placeMe(teleport));
    store.on('world', () => this.syncWorld());
    store.on('self', () => {
      this.updateNpcBubbles();
      this.updateTrainers();
      this.updateGates();
      if (store.self) this.me.name.setText(store.self.name);
      const lead = store.self?.party.find((m) => m.hp > 0) ?? store.self?.party[0] ?? null;
      this.setFollower(this.me, store.self?.down || !lead ? null : lead.species, lead?.tier ?? 1);
    });
    this.updateNpcBubbles();
    this.updateGates();
  }

  private fitZoom() {
    const h = this.scale.height, w = this.scale.width;
    const zoom = Math.max(0.75, Math.min(2.5, Math.min(h / (15 * T), w / (19 * T))));
    this.cameras.main.setZoom(zoom);
  }

  // ------------------------------------------------------------ generated textures

  private makeTextures() {
    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture('dot', 8, 8);
    g.clear();
    for (let r = 8; r > 0; r--) g.fillStyle(0xffffff, 0.12).fillCircle(8, 8, r);
    g.generateTexture('glow', 16, 16);
    g.clear();
    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 14, 2, 1);
    g.generateTexture('streak', 14, 2);
    g.clear();
    g.fillStyle(0xffffff, 1).fillTriangle(0, 4, 3, 0, 6, 4);
    g.generateTexture('leaf', 6, 5);
    g.destroy();
  }

  // ------------------------------------------------------------ static map

  private drawMap() {
    const { map } = store;
    const g = this.make.graphics({}, false);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) this.drawTile(g, x, y, map.tile(x, y), map.zoneAt(x, y));
    }
    // Ambient occlusion: walkable tiles under walls, trees and rocks get a soft shadow.
    for (let y = 1; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!map.isWalkable(x, y) || !BLOCKING_TILES.includes(map.tile(x, y - 1))) continue;
        for (let i = 0; i < 4; i++) g.fillStyle(0x000000, 0.16 - i * 0.04).fillRect(x * T, y * T + i * 2, T, 2);
      }
    }
    // Faint tier-coloured outline where walkable ground changes zone: a second hint at the boundary.
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const z = map.zoneAt(x, y);
        if (!z || !map.isWalkable(x, y)) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const n = map.zoneAt(x + dx, y + dy);
          if (n && n !== z && map.isWalkable(x + dx, y + dy)) {
            g.lineStyle(2, col(n.tierColor), 0.6);
            if (dx) g.lineBetween((x + 1) * T, y * T + 2, (x + 1) * T, (y + 1) * T - 2);
            else g.lineBetween(x * T + 2, (y + 1) * T, (x + 1) * T - 2, (y + 1) * T);
          }
        }
      }
    }
    const rt = this.add.renderTexture(0, 0, map.width * T, map.height * T).setOrigin(0, 0);
    rt.draw(g, 0, 0);
    g.destroy();
  }

  private groundDetail(g: Phaser.GameObjects.Graphics, x: number, y: number, zone: ZoneDef | null, base: number) {
    const px = x * T, py = y * T;
    const id = zone?.id ?? '';
    const r = (s: number) => rnd(x, y, s);
    if (id === 'town' || id === 'outpost') {
      // cobblestones
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        g.fillStyle(shade(base, (r(i * 2 + j) - 0.5) * 0.18), 1).fillRoundedRect(px + 1 + i * 16 + (j % 2) * 3, py + 1 + j * 16, 13, 13, 4);
      }
      return;
    }
    if (id === 'ruins' || id === 'throne') {
      // cracked flagstones with moss
      g.lineStyle(1, shade(base, -0.3), 0.8).strokeRect(px + 0.5, py + 0.5, 15, 15).strokeRect(px + 16.5, py + 0.5, 15, 15)
        .strokeRect(px + 0.5, py + 16.5, 31, 15);
      if (id === 'ruins' && r(1) > 0.6) g.fillStyle(0x6b9a5a, 0.55).fillCircle(px + r(2) * T, py + r(3) * T, 3 + r(4) * 3);
      if (id === 'throne' && r(1) > 0.85) g.fillStyle(0xffd700, 0.35).fillCircle(px + 16, py + 16, 2.5);
      return;
    }
    for (let i = 0; i < 3; i++) {
      g.fillStyle(shade(base, r(i) > 0.5 ? 0.1 : -0.1), 1);
      g.fillRect(px + r(i + 10) * (T - 4), py + r(i + 20) * (T - 4), 3, 2);
    }
    if (id === 'meadow' && r(30) < 0.16) {
      const fx = px + 6 + r(31) * 20, fy = py + 6 + r(32) * 20;
      const petal = [0xffffff, 0xffd84a, 0xff8fb8, 0xb59bff][Math.floor(r(33) * 4)];
      g.fillStyle(petal, 1);
      for (let k = 0; k < 5; k++) g.fillCircle(fx + Math.cos(k * 1.26) * 2.2, fy + Math.sin(k * 1.26) * 2.2, 1.6);
      g.fillStyle(0xf4b400, 1).fillCircle(fx, fy, 1.2);
    } else if (id === 'forest' && r(30) < 0.05) {
      const mx = px + 8 + r(31) * 16, my = py + 10 + r(32) * 14;
      g.fillStyle(0xf3e5c8, 1).fillRect(mx - 1, my, 2, 4);
      g.fillStyle(0xd23b3b, 1).fillEllipse(mx, my, 8, 5);
      g.fillStyle(0xffffff, 1).fillCircle(mx - 1.5, my - 0.5, 0.9).fillCircle(mx + 1.8, my, 0.7);
    } else if (id === 'marsh' && r(30) < 0.1) {
      g.fillStyle(0x4f5b3a, 0.6).fillEllipse(px + 8 + r(31) * 16, py + 10 + r(32) * 14, 12, 5);
    } else if (id === 'steppe' && r(30) < 0.3) {
      g.lineStyle(1, shade(base, -0.25), 0.9);
      const sx = px + 4 + r(31) * 22, sy = py + 8 + r(32) * 18;
      g.lineBetween(sx, sy, sx - 2, sy - 6).lineBetween(sx + 2, sy, sx + 3, sy - 5);
    } else if (id === 'peaks' && r(30) < 0.2) {
      g.fillStyle(0xeef3f8, 0.7).fillCircle(px + r(31) * T, py + r(32) * T, 1.5);
      g.fillStyle(shade(base, -0.25), 1).fillEllipse(px + 6 + r(33) * 20, py + 8 + r(34) * 18, 5, 3);
    } else if (id === 'wastes' && r(30) < 0.12) {
      g.lineStyle(1.5, 0xff6a1a, 0.55);
      const cx = px + 6 + r(31) * 20, cy = py + 6 + r(32) * 20;
      g.lineBetween(cx, cy, cx + 6, cy + 3).lineBetween(cx + 6, cy + 3, cx + 9, cy - 2);
    } else if (id === 'cave' && r(30) < 0.15) {
      g.fillStyle(0xb48cff, 0.5).fillCircle(px + r(31) * T, py + r(32) * T, 1.2);
    }
  }

  private drawTile(g: Phaser.GameObjects.Graphics, x: number, y: number, t: string, zone: ZoneDef | null) {
    const { map } = store;
    const px = x * T, py = y * T;
    const ground = col(zone?.groundColor ?? '#777777');
    const grass = col(zone?.grassColor ?? '#557755');
    const zid = zone?.id ?? '';
    const groundTile = () => {
      g.fillStyle(ground, 1).fillRect(px, py, T, T);
      this.groundDetail(g, x, y, zone, ground);
    };
    const shadow = (w: number) => g.fillStyle(0x000000, 0.22).fillEllipse(px + T / 2, py + T - 4, w, 8);
    switch (t) {
      case ',': {
        g.fillStyle(grass, 1).fillRect(px, py, T, T);
        g.fillStyle(shade(grass, -0.12), 1).fillRect(px, py + T - 6, T, 6);
        const dark = shade(grass, -0.32), light = shade(grass, 0.2);
        for (let row = 0; row < 3; row++) {
          for (let i = 0; i < 4; i++) {
            const bx = px + 1 + i * 8 + rnd(x, y, row * 4 + i) * 3, by = py + 9 + row * 9;
            g.fillStyle((i + row) % 2 ? dark : light, 1);
            g.fillTriangle(bx, by + 4, bx + 2.5, by - 6, bx + 5, by + 4);
          }
        }
        if (zid === 'meadow' && rnd(x, y, 50) < 0.1) g.fillStyle(0xfff3a0, 1).fillCircle(px + 8 + rnd(x, y, 51) * 16, py + 8 + rnd(x, y, 52) * 12, 1.8);
        break;
      }
      case '=': {
        g.fillStyle(0xd8b878, 1).fillRect(px, py, T, T);
        g.fillStyle(0xc4a263, 1);
        for (let i = 0; i < 4; i++) g.fillEllipse(px + 4 + rnd(x, y, i) * (T - 8), py + 4 + rnd(x, y, i + 3) * (T - 8), 3, 2);
        // darker edges where the path meets something else
        g.fillStyle(0xb08f55, 1);
        if (map.tile(x - 1, y) !== '=') g.fillRect(px, py, 2, T);
        if (map.tile(x + 1, y) !== '=') g.fillRect(px + T - 2, py, 2, T);
        if (map.tile(x, y - 1) !== '=') g.fillRect(px, py, T, 2);
        if (map.tile(x, y + 1) !== '=') g.fillRect(px, py + T - 2, T, 2);
        break;
      }
      case ':': {
        g.fillStyle(0x3b2530, 1).fillRect(px, py, T, T);
        g.lineStyle(1, 0x24151d, 1).strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        if (rnd(x, y) > 0.8) g.fillStyle(0x6e2c3e, 0.7).fillCircle(px + T / 2, py + T / 2, 3);
        break;
      }
      case 'T': {
        groundTile();
        if (zid === 'wastes') {
          shadow(18);
          g.lineStyle(3, 0x2b1d18, 1).lineBetween(px + 16, py + T - 4, px + 16, py + 8);
          g.lineStyle(2, 0x2b1d18, 1).lineBetween(px + 16, py + 16, px + 8, py + 9).lineBetween(px + 16, py + 13, px + 24, py + 6)
            .lineBetween(px + 8, py + 9, px + 6, py + 4);
        } else if (PINE_ZONES.has(zid)) {
          shadow(22);
          const c = shade(grass, -0.4);
          g.fillStyle(0x5b3a22, 1).fillRect(px + 14, py + 22, 4, 7);
          for (let i = 0; i < 3; i++) {
            const w = 22 - i * 5, top = py + 2 + i * 6, bot = py + 16 + i * 4;
            g.fillStyle(shade(c, i * 0.06), 1).fillTriangle(px + 16 - w / 2, bot, px + 16, top, px + 16 + w / 2, bot);
            g.fillStyle(shade(c, 0.22), 1).fillTriangle(px + 16 - w / 2 + 2, bot - 1, px + 16, top + 2, px + 14, bot - 1);
          }
        } else {
          shadow(26);
          const canopy = shade(grass, -0.35);
          g.fillStyle(0x6b4a2b, 1).fillRect(px + 13, py + 17, 6, 12);
          g.fillStyle(shade(canopy, -0.15), 1).fillCircle(px + 16, py + 14, 12);
          g.fillStyle(canopy, 1).fillCircle(px + 11, py + 13, 8).fillCircle(px + 21, py + 13, 8).fillCircle(px + 16, py + 8, 8);
          g.fillStyle(shade(canopy, 0.25), 1).fillCircle(px + 12, py + 8, 4).fillCircle(px + 18, py + 5, 3);
        }
        break;
      }
      case '^': {
        groundTile();
        if (zid === 'ruins') {
          // broken stone pillar
          shadow(18);
          g.fillStyle(0x8e9a8e, 1).fillRect(px + 9, py + 6, 14, 23);
          g.fillStyle(0xaab5aa, 1).fillRect(px + 9, py + 6, 4, 23);
          g.fillStyle(0x6f7a6f, 1).fillRect(px + 7, py + 26, 18, 4);
          g.fillStyle(0x7d887d, 1).fillTriangle(px + 9, py + 6, px + 16, py + 2, px + 23, py + 6);
          if (rnd(x, y, 7) > 0.5) g.fillStyle(0x6b9a5a, 0.8).fillCircle(px + 20, py + 12, 3);
          break;
        }
        const rock = zid === 'cave' ? 0x5d4f78 : zid === 'wastes' ? 0x2a2230 : zid === 'peaks' ? 0x7c818c : 0x8a8a8a;
        shadow(24);
        g.fillStyle(shade(rock, -0.35), 1);
        g.fillPoints([{ x: px + 3, y: py + T - 4 }, { x: px + 5, y: py + 12 }, { x: px + 14, y: py + 4 }, { x: px + 26, y: py + 8 }, { x: px + T - 3, y: py + T - 4 }], true);
        g.fillStyle(rock, 1);
        g.fillPoints([{ x: px + 6, y: py + T - 7 }, { x: px + 8, y: py + 13 }, { x: px + 15, y: py + 7 }, { x: px + 24, y: py + 10 }, { x: px + 26, y: py + T - 7 }], true);
        g.fillStyle(shade(rock, 0.3), 1).fillTriangle(px + 9, py + 13, px + 15, py + 8, px + 14, py + 15);
        if (zid === 'peaks') g.fillStyle(0xf4f8fb, 0.9).fillTriangle(px + 11, py + 10, px + 15, py + 6, px + 20, py + 9);
        if (zid === 'wastes') g.fillStyle(0x7a4cff, 0.35).fillTriangle(px + 16, py + 10, px + 22, py + 12, px + 18, py + 18);
        break;
      }
      case '~': {
        const water = zid === 'marsh' ? 0x3d6f76 : zid === 'ruins' ? 0x2f7f8f : 0x2f6fb5;
        g.fillStyle(water, 1).fillRect(px, py, T, T);
        g.fillStyle(shade(water, -0.15), 1).fillRect(px + 4, py + 4, T - 8, T - 8);
        // foam where the water meets land
        g.fillStyle(shade(water, 0.45), 0.9);
        if (map.tile(x - 1, y) !== '~') g.fillRect(px, py, 3, T);
        if (map.tile(x + 1, y) !== '~') g.fillRect(px + T - 3, py, 3, T);
        if (map.tile(x, y - 1) !== '~') g.fillRect(px, py, T, 3);
        if (map.tile(x, y + 1) !== '~') g.fillRect(px, py + T - 3, T, 3);
        if (zid === 'marsh' && rnd(x, y, 9) < 0.25) {
          g.fillStyle(0x4f9a4a, 1).fillCircle(px + 10 + rnd(x, y, 10) * 12, py + 10 + rnd(x, y, 11) * 12, 4);
          g.fillStyle(0xff9ad5, 1).fillCircle(px + 12 + rnd(x, y, 10) * 12, py + 9 + rnd(x, y, 11) * 12, 1.5);
        }
        break;
      }
      case '%': {
        g.fillStyle(0x5a1206, 1).fillRect(px, py, T, T);
        g.fillStyle(0xc4300a, 1).fillRect(px + 3, py + 3, T - 6, T - 6);
        g.fillStyle(0xff7a1a, 1).fillCircle(px + 8 + rnd(x, y, 1) * 16, py + 8 + rnd(x, y, 2) * 16, 4 + rnd(x, y, 3) * 3);
        g.lineStyle(2, 0xffc040, 0.8).lineBetween(px + 4, py + 10 + rnd(x, y, 4) * 12, px + 28, py + 14 + rnd(x, y, 5) * 10);
        g.fillStyle(0x2b1d18, 1);
        if (map.tile(x, y - 1) !== '%') g.fillRect(px, py, T, 3);
        if (map.tile(x, y + 1) !== '%') g.fillRect(px, py + T - 3, T, 3);
        break;
      }
      case '#': {
        if (zid === 'arena') {
          g.fillStyle(0x1e141a, 1).fillRect(px, py, T, T);
          g.lineStyle(1, 0x3a2a33, 1);
          g.strokeRect(px + 1, py + 1, T / 2 - 1, T / 2 - 1).strokeRect(px + T / 2, py + 1, T / 2 - 1, T / 2 - 1);
          g.strokeRect(px + 1, py + T / 2, T - 2, T / 2 - 1);
        } else if (zid === 'outpost') {
          // pointed log palisade
          g.fillStyle(ground, 1).fillRect(px, py, T, T);
          for (let i = 0; i < 4; i++) {
            const lx = px + i * 8;
            g.fillStyle(i % 2 ? 0x7a5230 : 0x8b5e34, 1).fillRect(lx + 1, py + 6, 6, T - 6);
            g.fillTriangle(lx + 1, py + 6, lx + 4, py + 1, lx + 7, py + 6);
            g.fillStyle(0x5e3d22, 1).fillRect(lx + 1, py + 14, 6, 2);
          }
        } else {
          g.fillStyle(col('#d8c8a0'), 1).fillRect(px, py, T, T);
          g.fillStyle(0x000000, 0.12).fillRect(px, py + 26, T, 4);
          g.fillStyle(0x8b5e34, 1).fillRect(px, py + 10, T, 4).fillRect(px, py + 20, T, 4);
          g.fillStyle(0xa8743d, 1).fillRect(px, py + 10, T, 1).fillRect(px, py + 20, T, 1);
          g.fillStyle(0x6b4423, 1).fillRect(px + 4, py + 4, 5, T - 6).fillRect(px + T - 9, py + 4, 5, T - 6);
          g.fillStyle(0x8b5e34, 1).fillRect(px + 4, py + 4, 2, T - 6).fillRect(px + T - 9, py + 4, 2, T - 6);
        }
        break;
      }
      case '*': {
        groundTile();
        g.fillStyle(0xb48cff, 0.25).fillCircle(px + T / 2, py + T / 2, 14);
        g.fillStyle(0x9b6bff, 1).fillPoints([{ x: px + 16, y: py + 2 }, { x: px + 24, y: py + 16 }, { x: px + 16, y: py + 30 }, { x: px + 8, y: py + 16 }], true);
        g.fillStyle(0x7fe9ff, 1).fillPoints([{ x: px + 16, y: py + 4 }, { x: px + 20, y: py + 16 }, { x: px + 16, y: py + 18 }], true);
        g.fillStyle(0xc9a6ff, 1).fillPoints([{ x: px + 25, y: py + 18 }, { x: px + 29, y: py + 24 }, { x: px + 25, y: py + 30 }, { x: px + 21, y: py + 24 }], true);
        break;
      }
      default:
        groundTile();
    }
  }

  /** Shimmer on water and glow on lava: cheap tweened sprites over the baked map. */
  private animateLiquids() {
    const { map } = store;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.tile(x, y);
        if (t === '~' && rnd(x, y, 70) < 0.45) {
          const s = this.add.image(x * T + 6 + rnd(x, y, 71) * 18, y * T + 8 + rnd(x, y, 72) * 16, 'streak')
            .setAlpha(0).setDepth(1).setScale(0.6 + rnd(x, y, 73) * 0.5, 1);
          this.tweens.add({
            targets: s, alpha: { from: 0, to: 0.7 }, x: s.x + 5, duration: 900 + rnd(x, y, 74) * 700,
            yoyo: true, repeat: -1, delay: rnd(x, y, 75) * 3000, repeatDelay: 600 + rnd(x, y, 76) * 2400,
          });
        } else if (t === '%' && rnd(x, y, 70) < 0.6) {
          const s = this.add.image(x * T + 16, y * T + 16, 'glow').setTint(0xff7a1a).setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(1).setScale(2.4).setAlpha(0.3);
          this.tweens.add({
            targets: s, alpha: { from: 0.15, to: 0.55 }, scale: { from: 2, to: 2.8 }, duration: 1200 + rnd(x, y, 74) * 900,
            yoyo: true, repeat: -1, delay: rnd(x, y, 75) * 1500, ease: 'Sine.easeInOut',
          });
        }
      }
    }
  }

  private makeAmbient() {
    const common = { emitting: false, emitZone: { type: 'random', source: this.ambientZone } as Phaser.Types.GameObjects.Particles.EmitZoneData };
    const make = (kind: Ambient, tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const e = this.add.particles(0, 0, tex, { ...common, ...cfg }).setDepth(12);
      this.ambient.set(kind, e);
    };
    make('pollen', 'dot', { lifespan: 6000, speedX: { min: -8, max: 12 }, speedY: { min: -10, max: 4 }, scale: { start: 0.35, end: 0.15 }, alpha: { start: 0.55, end: 0 }, tint: [0xfff6b0, 0xffffff], frequency: 260 });
    make('firefly', 'glow', { lifespan: 4000, speedX: { min: -12, max: 12 }, speedY: { min: -12, max: 12 }, scale: { start: 0.5, end: 0.2 }, alpha: { start: 0.9, end: 0 }, tint: [0xd8ff6a, 0xfff07a], blendMode: 'ADD', frequency: 220 });
    make('sparkle', 'glow', { lifespan: 1400, speedY: { min: -6, max: 2 }, scale: { start: 0.1, end: 0.6 }, alpha: { start: 0.9, end: 0 }, tint: [0xb48cff, 0x7fe9ff, 0xffffff], blendMode: 'ADD', frequency: 140 });
    make('wind', 'streak', { lifespan: 1600, speedX: { min: 140, max: 220 }, speedY: { min: -6, max: 6 }, scaleX: { min: 1, max: 2.5 }, alpha: { start: 0.35, end: 0 }, tint: 0xffffff, frequency: 90 });
    make('ember', 'glow', { lifespan: 3000, speedX: { min: -10, max: 10 }, speedY: { min: -40, max: -15 }, scale: { start: 0.45, end: 0.1 }, alpha: { start: 0.9, end: 0 }, tint: [0xff7a1a, 0xffc040, 0xff3b1a], blendMode: 'ADD', frequency: 150 });
    this.leaves = this.add.particles(0, 0, 'leaf', {
      emitting: false, lifespan: 600, speed: { min: 30, max: 70 }, angle: { min: 200, max: 340 }, gravityY: 160,
      rotate: { min: 0, max: 360 }, scale: { start: 1, end: 0.6 }, alpha: { start: 1, end: 0 }, tint: [0x8fdc6a, 0x5fae3c, 0xc9e88a],
    }).setDepth(9);
  }

  private setAmbient(zoneId: string) {
    const kind = ZONE_AMBIENT[zoneId];
    for (const [k, e] of this.ambient) {
      if (k === kind) e.start();
      else e.stop();
    }
  }

  private drawObjects() {
    const { data } = store;
    const g = this.add.graphics().setDepth(5);
    for (const o of data.map.objects) {
      const cx = o.x * T + T / 2, cy = o.y * T + T / 2;
      switch (o.type) {
        case 'heal':
          g.fillStyle(0x000000, 0.25).fillEllipse(cx, cy + 12, 26, 8);
          g.fillStyle(0xffffff, 1).fillCircle(cx, cy, 13);
          g.lineStyle(2, 0xe84a7f, 1).strokeCircle(cx, cy, 13);
          g.fillStyle(0xe84a7f, 1).fillRect(cx - 3, cy - 9, 6, 18).fillRect(cx - 9, cy - 3, 18, 6);
          this.label(cx, cy - 20, 'Healing Spring (E)');
          break;
        case 'shop':
          g.fillStyle(0x000000, 0.25).fillEllipse(cx, cy + 13, 30, 8);
          g.fillStyle(0xf3e5c0, 1).fillRect(cx - 13, cy - 4, 26, 18);
          g.fillStyle(0x2e86c1, 1).fillTriangle(cx - 16, cy - 3, cx, cy - 16, cx + 16, cy - 3);
          g.fillStyle(0x5dade2, 1).fillTriangle(cx - 16, cy - 3, cx, cy - 16, cx - 2, cy - 3);
          g.fillStyle(0x7b4a24, 1).fillRect(cx - 4, cy + 4, 8, 10);
          g.fillStyle(0xaed6f1, 1).fillRect(cx - 11, cy, 5, 5).fillRect(cx + 6, cy, 5, 5);
          this.label(cx, cy - 24, 'Shop (E)');
          break;
        case 'fusion': {
          g.fillStyle(0x000000, 0.25).fillEllipse(cx, cy + 13, 34, 8);
          g.fillStyle(0x3d2b56, 1).fillRoundedRect(cx - 15, cy - 6, 30, 19, 4);
          g.fillStyle(0x7fe9ff, 0.85).fillRoundedRect(cx - 14, cy - 16, 7, 18, 3);
          g.fillStyle(0xff8ad8, 0.85).fillRoundedRect(cx + 7, cy - 16, 7, 18, 3);
          g.fillStyle(0xd7a8ff, 0.35).fillCircle(cx, cy + 2, 9);
          g.fillStyle(0xf5e1ff, 1).fillCircle(cx, cy + 2, 4.5);
          g.lineStyle(1.5, 0xb48cff, 1).strokeRoundedRect(cx - 15, cy - 6, 30, 19, 4);
          const orb = this.add.image(cx, cy + 2, 'glow').setTint(0xd7a8ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(5).setScale(1.6);
          this.tweens.add({ targets: orb, alpha: { from: 0.3, to: 0.9 }, duration: 900, yoyo: true, repeat: -1 });
          this.label(cx, cy - 25, 'Fusion Lab (E)');
          break;
        }
        case 'npc': {
          const npc = data.quests.npcs[o.id!];
          this.drawPerson(g, cx, cy, col(npc.color), o.id === 'warden' ? 'helmet' : 'hair');
          this.label(cx, cy + 22, npc.name);
          const bubble = this.add.text(cx, cy - 28, '!', { ...TEXT_STYLE, fontSize: '18px', color: '#ffd84a', fontStyle: 'bold' })
            .setOrigin(0.5).setResolution(2).setDepth(6);
          this.tweens.add({ targets: bubble, y: cy - 32, yoyo: true, repeat: -1, duration: 500 });
          this.npcBubbles.set(o.id!, bubble);
          break;
        }
        case 'sign':
          this.drawSign(g, o);
          break;
        case 'trainer':
          this.drawTrainer(o);
          break;
        case 'portal': {
          const pg = this.add.graphics({ x: cx, y: cy }).setDepth(3);
          this.portals.push({ g: pg, label: this.label(cx, o.y * T - 6, 'Boss Portal') });
          break;
        }
        case 'gate':
          this.gates.push({ g: this.add.graphics({ x: o.x * T, y: o.y * T }).setDepth(5), o });
          break;
      }
    }
  }

  /** Draws an NPC-style person into a shared Graphics. */
  private drawPerson(g: Phaser.GameObjects.Graphics, cx: number, cy: number, c: number, head: 'hair' | 'helmet') {
    g.fillStyle(0x000000, 0.25).fillEllipse(cx, cy + 13, 22, 7);
    g.fillStyle(0x2c3e50, 1).fillRoundedRect(cx - 6, cy + 6, 5, 7, 2).fillRoundedRect(cx + 1, cy + 6, 5, 7, 2);
    g.fillStyle(c, 1).fillRoundedRect(cx - 9, cy - 3, 18, 13, 4);
    g.lineStyle(1.5, shade(c, -0.45), 1).strokeRoundedRect(cx - 9, cy - 3, 18, 13, 4);
    g.fillStyle(0xf2d2b0, 1).fillCircle(cx, cy - 10, 7);
    if (head === 'helmet') {
      g.fillStyle(0x95a5a6, 1).fillRoundedRect(cx - 8, cy - 19, 16, 8, { tl: 7, tr: 7, bl: 1, br: 1 });
      g.fillStyle(0xc0392b, 1).fillRect(cx - 1, cy - 23, 2, 5);
    } else {
      g.fillStyle(shade(c, -0.55), 1).fillRoundedRect(cx - 7, cy - 18, 14, 6, { tl: 6, tr: 6, bl: 1, br: 1 });
    }
    g.fillStyle(0x222222, 1).fillCircle(cx - 2.5, cy - 9, 1.3).fillCircle(cx + 2.5, cy - 9, 1.3);
  }

  private drawTrainer(o: MapObject) {
    const t = store.data.trainers[o.id!];
    const g = this.add.graphics();
    const c = col(t.color);
    if (t.elite) {
      // golden dais and aura for the final challenge
      g.fillStyle(0x3b2f14, 1).fillEllipse(0, 14, 56, 18);
      g.lineStyle(2, 0xffd700, 1).strokeEllipse(0, 14, 56, 18);
      const aura = this.add.image(o.x * T + T / 2, o.y * T + T / 2, 'glow').setTint(0xffd700).setBlendMode(Phaser.BlendModes.ADD).setScale(4).setDepth(6.5);
      this.tweens.add({ targets: aura, alpha: { from: 0.35, to: 0.8 }, scale: { from: 3.6, to: 4.4 }, duration: 1300, yoyo: true, repeat: -1 });
    }
    const gym = gymOfLeader(store.data, o.id!);
    if (gym) {
      const gc = col(gym.color);
      g.fillStyle(shade(gc, -0.6), 1).fillEllipse(0, 14, 50, 16);
      g.lineStyle(2, gc, 1).strokeEllipse(0, 14, 50, 16);
      const aura = this.add.image(o.x * T + T / 2, o.y * T + T / 2, 'glow').setTint(gc).setBlendMode(Phaser.BlendModes.ADD).setScale(3).setDepth(6.5);
      this.tweens.add({ targets: aura, alpha: { from: 0.25, to: 0.6 }, duration: 1500, yoyo: true, repeat: -1 });
    }
    this.drawPerson(g, 0, 0, c, 'hair');
    const [fx, fy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[t.facing];
    // cap brim in the facing direction
    g.fillStyle(shade(c, -0.35), 1).fillRect(-8 + (fx > 0 ? 8 : fx < 0 ? -4 : 0), -14, 12, 3);
    // facing arrow: shows which way they're watching
    g.fillStyle(0xffffff, 0.8).fillTriangle(fx * 19 + fy * 4, fy * 19 + fx * 4, fx * 19 - fy * 4, fy * 19 - fx * 4, fx * 24, fy * 24);
    if (t.elite) {
      // crown
      g.fillStyle(0xffd700, 1).fillPoints([{ x: -8, y: -17 }, { x: -8, y: -24 }, { x: -4, y: -20 }, { x: 0, y: -26 }, { x: 4, y: -20 }, { x: 8, y: -24 }, { x: 8, y: -17 }], true);
      g.fillStyle(0xe74c3c, 1).fillCircle(0, -20, 1.6);
    }
    const label = this.add.text(0, 24, this.trainerLabel(o.id!), { ...TEXT_STYLE, color: t.elite ? '#ffd700' : gym ? gym.color : '#ffd0a0', fontSize: t.elite || gym ? '13px' : '11px' }).setOrigin(0.5).setResolution(2);
    const cont = this.add.container(o.x * T + T / 2, o.y * T + T / 2, [g, label]).setDepth(7);
    this.trainers.set(o.id!, { c: cont, label });
  }

  private trainerLabel(id: string): string {
    const t = store.data.trainers[id];
    const gym = gymOfLeader(store.data, id);
    return t.elite ? `👑 ${t.name}` : gym ? `${gym.icon} ${t.name}` : t.name;
  }

  private updateTrainers() {
    const beaten = new Set(store.self?.defeatedTrainers ?? []);
    for (const [id, t] of this.trainers) {
      const done = beaten.has(id);
      t.c.setAlpha(done ? 0.55 : 1);
      t.label.setText(this.trainerLabel(id) + (done ? ' (beaten)' : ''));
    }
  }

  private gateIsOpen(): boolean {
    const quest = this.gates[0]?.o.quest;
    return !quest || store.self?.quests[quest]?.state === 'done';
  }

  private updateGates() {
    const open = this.gateIsOpen();
    if (open === this.gateOpen) return;
    this.gateOpen = open;
    for (const { g } of this.gates) {
      g.clear();
      g.fillStyle(0x5e3d22, 1).fillRect(2, 4, 5, 26).fillRect(T - 7, 4, 5, 26);
      if (open) {
        // barrier raised
        g.fillStyle(0xffffff, 1).fillRect(4, -14, 4, 20);
        g.fillStyle(0xd23b3b, 1).fillRect(4, -10, 4, 4).fillRect(4, -2, 4, 4);
      } else {
        g.fillStyle(0xffffff, 1).fillRect(0, 12, T, 6);
        for (let i = 0; i < 4; i++) g.fillStyle(0xd23b3b, 1).fillRect(i * 8, 12, 4, 6);
        g.fillStyle(0xffd84a, 1).fillCircle(T / 2, 15, 2);
      }
    }
  }

  private drawSign(g: Phaser.GameObjects.Graphics, o: MapObject) {
    const zone = store.data.zones.find((z) => z.id === o.zone)!;
    const cx = o.x * T + T / 2, cy = o.y * T + T / 2;
    g.fillStyle(0x000000, 0.2).fillEllipse(cx, cy + 13, 14, 4);
    g.fillStyle(0x5a3b1e, 1).fillRect(cx - 2, cy - 2, 4, 15);
    g.fillStyle(0xa8743d, 1).fillRect(cx - 12, cy - 12, 24, 13);
    g.lineStyle(2, col(zone.tierColor), 1).strokeRect(cx - 12, cy - 12, 24, 13);
    const lines = [zone.name, [zoneLevelLabel(zone), recommendedLabel(zone.recommended)].filter(Boolean).join(' · ')];
    this.add.text(cx, cy - 16, lines.join('\n'), {
      ...TEXT_STYLE, fontSize: '10px', align: 'center', backgroundColor: zone.tierColor + 'dd', color: '#111111',
      strokeThickness: 0, padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setResolution(2).setDepth(6);
  }

  private label(x: number, y: number, text: string) {
    return this.add.text(x, y, text, TEXT_STYLE).setOrigin(0.5).setResolution(2).setDepth(6);
  }

  private updateNpcBubbles() {
    const self = store.self;
    for (const [npcId, bubble] of this.npcBubbles) {
      let mark = '';
      if (self) {
        for (const q of store.data.quests.quests.filter((q) => q.giver === npcId)) {
          const st = self.quests[q.id];
          if (st?.state === 'active' && q.objectives.every((o, i) => st.progress[i] >= o.count)) { mark = '?'; break; }
          if (!st && q.requires.every((r) => self.quests[r]?.state === 'done')) mark = '!';
        }
      }
      bubble.setText(mark).setColor(mark === '?' ? '#7dff7a' : '#ffd84a');
    }
  }

  // ------------------------------------------------------------ avatars + followers

  private makeAvatar(name: string, color: string, isMe: boolean): Avatar {
    const body = this.add.graphics();
    const nameText = this.add.text(0, -30, name, { ...TEXT_STYLE, color: isMe ? '#ffffff' : '#e8e8e8' }).setOrigin(0.5).setResolution(2);
    const icon = this.add.text(0, -44, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5).setResolution(2);
    const c = this.add.container(0, 0, [body, nameText, icon]).setDepth(isMe ? 11 : 10);
    const a: Avatar = {
      c, name: nameText, body, icon, isMe, color, tx: 0, ty: 0, tileX: -1, tileY: -1, state: 'free', connected: true,
      facing: [0, 1], walkUntil: 0, frame: 0, follower: null, followerShadow: null, followerSpecies: null, fx: 0, fy: 0,
    };
    this.paintAvatar(a);
    return a;
  }

  /** A little trainer: legs, jacket in the player's colour, cap facing the walking direction. */
  private paintAvatar(a: Avatar) {
    const g = a.body;
    g.clear();
    if (a.state === 'down') {
      g.fillStyle(0x000000, 0.25).fillEllipse(0, 11, 20, 6);
      g.fillStyle(0x9a9a9a, 1).fillRoundedRect(-8, -10, 16, 20, { tl: 8, tr: 8, bl: 1, br: 1 });
      g.fillStyle(0x6b6b6b, 1).fillRect(-1.5, -6, 3, 10).fillRect(-5, -3, 10, 3);
      return;
    }
    const c = col(a.color), dark = shade(c, -0.45);
    const [fx, fy] = a.facing;
    const swing = a.frame === 0 ? 0 : a.frame === 1 ? 2 : -2;
    g.fillStyle(0x000000, 0.28).fillEllipse(0, 13, 20, 6);
    if (a.isMe) g.lineStyle(1.5, 0xffffff, 0.55).strokeEllipse(0, 13, 26, 9);
    // legs
    g.fillStyle(0x2c3e50, 1).fillRoundedRect(-6, 5 + Math.max(0, swing) * 0.5, 5, 8 - Math.max(0, swing) * 0.5, 2)
      .fillRoundedRect(1, 5 + Math.max(0, -swing) * 0.5, 5, 8 - Math.max(0, -swing) * 0.5, 2);
    // arms
    g.fillStyle(shade(c, -0.2), 1).fillRoundedRect(-10, -3 + swing * 0.6, 3, 9, 1.5).fillRoundedRect(7, -3 - swing * 0.6, 3, 9, 1.5);
    // jacket
    g.fillStyle(c, 1).fillRoundedRect(-8, -4, 16, 12, 4);
    g.lineStyle(1.5, dark, 1).strokeRoundedRect(-8, -4, 16, 12, 4);
    g.fillStyle(shade(c, 0.25), 1).fillRect(-1, -3, 2, 10);
    // head + cap
    g.fillStyle(0xf2d2b0, 1).fillCircle(0, -11, 7);
    g.lineStyle(1, 0xc9a47e, 1).strokeCircle(0, -11, 7);
    g.fillStyle(dark, 1).fillRoundedRect(-7, -19, 14, 6, { tl: 6, tr: 6, bl: 1, br: 1 });
    if (fy > 0) g.fillRect(-6, -14, 12, 2);
    else if (fx < 0) g.fillRect(-11, -14, 7, 2);
    else if (fx > 0) g.fillRect(4, -14, 7, 2);
    // face
    g.fillStyle(0x222222, 1);
    if (fy > 0) g.fillCircle(-2.5, -10, 1.3).fillCircle(2.5, -10, 1.3);
    else if (fx < 0) g.fillCircle(-3.5, -10, 1.3);
    else if (fx > 0) g.fillCircle(3.5, -10, 1.3);
  }

  /** Loads a monster portrait (SVG) as a Phaser texture, then calls back. */
  private withTexture(species: string, tier: number, cb: (key: string) => void) {
    const key = `mon-${species}-${tier}`;
    if (this.textures.exists(key)) return cb(key);
    const waiting = this.texWaiting.get(key);
    if (waiting) { waiting.push(() => cb(key)); return; }
    this.texWaiting.set(key, [() => cb(key)]);
    // render at 2x so it stays crisp when the camera zooms in
    this.textures.addBase64(key, 'data:image/svg+xml;base64,' + btoa(portraitFor(species, 96, tier, false)));
  }

  /** Your lead monster walks one tile behind you (everyone's does). */
  private setFollower(a: Avatar, species: string | null, tier = 1) {
    const want = species ? `${species}-${tier}` : null;
    if (want === a.followerSpecies) return;
    a.followerSpecies = want;
    a.follower?.destroy();
    a.followerShadow?.destroy();
    a.follower = null;
    a.followerShadow = null;
    if (!species) return;
    this.withTexture(species, tier, (key) => {
      if (a.followerSpecies !== want) return;
      a.follower?.destroy();
      a.followerShadow?.destroy();
      const x = a.fx || a.c.x, y = a.fy || a.c.y;
      a.followerShadow = this.add.ellipse(x, y + 12, 22, 7, 0x000000, 0.25).setDepth(8);
      a.follower = this.add.image(x, y, key).setDisplaySize(FOLLOWER_SIZE, FOLLOWER_SIZE).setDepth(a.isMe ? 10.5 : 9.5).setOrigin(0.5, 0.8);
      // pop in
      a.follower.setScale(0.01);
      this.tweens.add({ targets: a.follower, scaleX: FOLLOWER_SIZE / 96, scaleY: FOLLOWER_SIZE / 96, duration: 260, ease: 'Back.easeOut' });
    });
  }

  /** Called whenever an avatar enters a new tile: the follower takes the tile it just left. */
  private stepTo(a: Avatar, tileX: number, tileY: number, animate: boolean) {
    const prevX = a.tileX, prevY = a.tileY;
    if (prevX === tileX && prevY === tileY) return;
    a.tileX = tileX;
    a.tileY = tileY;
    if (prevX < 0 || !animate) {
      a.fx = tileX * T + T / 2;
      a.fy = tileY * T + T / 2 + 2;
      if (a.follower) a.follower.setPosition(a.fx, a.fy).setData('gy', a.fy);
      return;
    }
    const dx = Math.sign(tileX - prevX), dy = Math.sign(tileY - prevY);
    if (dx || dy) a.facing = [dx, dy];
    a.fx = prevX * T + T / 2;
    a.fy = prevY * T + T / 2 + 2;
    a.walkUntil = this.time.now + store.data.config.moveIntervalMs + 60;
    if (store.map.isGrass(tileX, tileY)) this.leaves.explode(5, tileX * T + T / 2, tileY * T + T - 6);
  }

  private placeMe(teleport: boolean) {
    const x = store.pos.x * T + T / 2, y = store.pos.y * T + T / 2;
    this.tweens.killTweensOf(this.me.c);
    if (teleport) this.me.c.setPosition(x, y);
    else this.tweens.add({ targets: this.me.c, x, y, duration: 90 });
    this.stepTo(this.me, store.pos.x, store.pos.y, !teleport);
    this.onMoved();
  }

  private onMoved() {
    const z = store.map.zoneAt(store.pos.x, store.pos.y);
    if (z && z.id !== this.lastZone) {
      this.lastZone = z.id;
      store.emit('zone', z);
      this.setAmbient(z.id);
    }
    store.emit('near', store.map.objectsNear(store.pos.x, store.pos.y));
  }

  private syncWorld() {
    const w = store.world;
    if (!w) return;
    const seen = new Set<string>();
    for (const p of w.players) {
      if (p.id === store.myId) {
        this.updateMe(p);
        continue;
      }
      seen.add(p.id);
      let a = this.others.get(p.id);
      if (!a) {
        a = this.makeAvatar(p.name, p.color, false);
        a.c.setPosition(p.x * T + T / 2, p.y * T + T / 2);
        this.others.set(p.id, a);
      }
      a.tx = p.x * T + T / 2;
      a.ty = p.y * T + T / 2;
      this.stepTo(a, p.x, p.y, Math.abs(p.x - a.tileX) + Math.abs(p.y - a.tileY) === 1);
      this.applyState(a, p);
      this.setFollower(a, p.state === 'down' ? null : p.lead, p.leadTier ?? 1);
    }
    for (const [id, a] of this.others) {
      if (!seen.has(id)) { a.c.destroy(); a.follower?.destroy(); a.followerShadow?.destroy(); this.others.delete(id); }
    }
    this.syncMarkers();
  }

  private updateMe(p: WorldPlayer) {
    if (p.color !== this.me.color || p.state !== this.me.state) {
      this.me.color = p.color;
      this.applyState(this.me, p, true);
    }
  }

  private applyState(a: Avatar, p: WorldPlayer, force = false) {
    if (force || a.state !== p.state || a.connected !== p.connected || a.color !== p.color) {
      a.state = p.state;
      a.connected = p.connected;
      a.color = p.color;
      this.paintAvatar(a);
      a.icon.setText(p.state === 'battle' ? '⚔' : p.state === 'down' ? '💀' : '');
      a.c.setAlpha(p.connected ? 1 : 0.45);
    }
  }

  private syncMarkers() {
    const w = store.world!;
    const live = new Set<string>();
    for (const b of w.battles) {
      if (b.kind === 'boss' || b.kind === 'duel') continue;
      live.add(b.id);
      let m = this.markers.get(b.id);
      if (!m) {
        const ring = this.add.graphics();
        const r = (store.data.config.combat.joinRadius + 0.5) * T;
        const colr = b.joinable ? 0xff4d4d : 0xb48cff;
        ring.fillStyle(colr, 0.12).fillCircle(0, 0, r);
        ring.lineStyle(2, colr, 0.9).strokeCircle(0, 0, r);
        const label = this.add.text(0, -r - 8, '', { ...TEXT_STYLE, fontSize: '12px' }).setOrigin(0.5).setResolution(2);
        const c = this.add.container(b.x * T + T / 2, b.y * T + T / 2, [ring, label]).setDepth(4);
        this.tweens.add({ targets: ring, alpha: 0.4, yoyo: true, repeat: -1, duration: 600 });
        m = { c, ring, label };
        this.markers.set(b.id, m);
      }
      m.label.setText(b.joinable ? `⚔ ${b.count} · walk in to join` : '✦ private encounter');
    }
    for (const [id, m] of this.markers) {
      if (!live.has(id)) { m.c.destroy(); this.markers.delete(id); }
    }
  }

  // ------------------------------------------------------------ frame loop

  private heldDir(): [number, number] | null {
    const k = this.keys;
    if (isTyping()) return null;
    if (k.UP.isDown || k.W.isDown) return [0, -1];
    if (k.DOWN.isDown || k.S.isDown) return [0, 1];
    if (k.LEFT.isDown || k.A.isDown) return [-1, 0];
    if (k.RIGHT.isDown || k.D.isDown) return [1, 0];
    return null;
  }

  private tryStep(time: number, dir: [number, number]) {
    const nx = store.pos.x + dir[0], ny = store.pos.y + dir[1];
    if (!store.map.isWalkable(nx, ny)) {
      if (this.me.facing[0] !== dir[0] || this.me.facing[1] !== dir[1]) { this.me.facing = dir; this.paintAvatar(this.me); }
      return;
    }
    const gate = store.map.gateQuest(nx, ny);
    if (gate && store.self?.quests[gate]?.state !== 'done') {
      if (time - this.lastGateToast > 3000) {
        this.lastGateToast = time;
        const q = store.data.quests.quests.find((x) => x.id === gate);
        const giver = q ? store.data.quests.npcs[q.giver].name : 'The warden';
        store.emit('toast', `${giver}: "Nobody passes until they complete ${q?.name ?? 'my task'}." (talk to them with E)`, 'bad');
      }
      return;
    }
    store.pos = { x: nx, y: ny };
    net.send({ t: 'move', x: nx, y: ny });
    this.nextStepAt = time + store.data.config.moveIntervalMs;
    const tx = nx * T + T / 2, ty = ny * T + T / 2;
    this.tweens.killTweensOf(this.me.c);
    this.tweens.add({ targets: this.me.c, x: tx, y: ty, duration: store.data.config.moveIntervalMs });
    this.stepTo(this.me, nx, ny, true);
    this.onMoved();
  }

  update(time: number, delta: number) {
    if (store.canMove() && time >= this.nextStepAt) {
      const dir = this.heldDir();
      if (dir) this.tryStep(time, dir);
    }
    const k = Math.min(1, delta / 90);
    const animate = (a: Avatar) => {
      // two-frame walk cycle while moving
      const walking = time < a.walkUntil;
      const frame = walking ? (Math.floor(time / 110) % 2) + 1 : 0;
      if (frame !== a.frame) { a.frame = frame; this.paintAvatar(a); }
      a.body.y = walking ? -Math.abs(Math.sin(time / 70)) * 1.5 : 0;
      const f = a.follower;
      if (f) {
        const prevX = f.x;
        f.x += (a.fx - f.x) * Math.min(1, delta / 120);
        const groundY = (f.getData('gy') as number | undefined) ?? f.y;
        const gy = groundY + (a.fy - groundY) * Math.min(1, delta / 120);
        f.setData('gy', gy);
        // hop while walking, gentle breathing while idle
        const hop = walking ? Math.abs(Math.sin(time / 85)) * 5 : 0;
        f.y = gy - hop;
        const breathe = walking ? 0 : Math.sin(time / 300 + a.fx) * 0.03;
        const k0 = FOLLOWER_SIZE / 96;
        if (!this.tweens.isTweening(f)) f.setScale(k0 * (1 - breathe * 0.5), k0 * (1 + breathe));
        if (Math.abs(f.x - prevX) > 0.3) f.setFlipX(f.x > prevX);
        // draw behind the trainer when above them, in front when below
        f.setDepth((a.isMe ? 11 : 10) + (gy > a.c.y + 2 ? 0.3 : -0.3));
        const visible = a.state !== 'down';
        f.setVisible(visible);
        if (a.followerShadow) a.followerShadow.setPosition(f.x, gy + 9).setVisible(visible).setScale(1 - hop / 14);
      }
    };
    animate(this.me);
    for (const a of this.others.values()) {
      a.c.x += (a.tx - a.c.x) * k;
      a.c.y += (a.ty - a.c.y) * k;
      animate(a);
    }
    // ambient particles cover whatever the camera sees
    const view = this.cameras.main.worldView;
    this.ambientZone.setTo(0, 0, view.width, view.height);
    for (const e of this.ambient.values()) e.setPosition(view.x, view.y);
    // Portals glow while a boss fight is running.
    const active = store.world?.boss.phase === 'fight';
    const pulse = 0.5 + 0.5 * Math.sin(time / 250);
    for (const { g, label } of this.portals) {
      g.clear();
      g.fillStyle(active ? 0x9b59b6 : 0x4a3f55, active ? 0.35 + pulse * 0.3 : 0.5).fillEllipse(0, 4, 28, 14);
      g.lineStyle(2, active ? 0xe0b0ff : 0x6d607a, 1).strokeEllipse(0, 4, 28 + (active ? pulse * 6 : 0), 14 + (active ? pulse * 3 : 0));
      if (active) g.fillStyle(0xe0b0ff, 0.25 + pulse * 0.2).fillEllipse(0, -6, 10, 26);
      label.setText(active ? 'Boss Portal: OPEN' : 'Boss Portal').setColor(active ? '#e0b0ff' : '#cccccc');
    }
  }
}

export function createGame(parent: string): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#101418',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    render: { antialias: true, roundPixels: false },
    scene: [WorldScene],
    banner: false,
  });
}
