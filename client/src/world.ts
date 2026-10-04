import Phaser from 'phaser';
import type { MapObject, WorldPlayer, ZoneDef } from '../../shared/types';
import { recommendedLabel, zoneLevelLabel } from '../../shared/map';
import { net } from './net';
import { store } from './state';

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

interface Avatar {
  c: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  tx: number;
  ty: number;
  state: string;
  connected: boolean;
}

export class WorldScene extends Phaser.Scene {
  private me!: Avatar;
  private others = new Map<string, Avatar>();
  private markers = new Map<string, { c: Phaser.GameObjects.Container; ring: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private npcBubbles = new Map<string, Phaser.GameObjects.Text>();
  private trainers = new Map<string, { c: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text }>();
  private portalG!: Phaser.GameObjects.Graphics;
  private portalLabel!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private nextStepAt = 0;
  private lastZone = '';

  constructor() {
    super('world');
  }

  create() {
    const { map } = store;
    this.cameras.main.setBackgroundColor('#101418');
    this.drawMap();
    this.drawObjects();

    this.me = this.makeAvatar(store.self?.name ?? 'You', '#ffffff', true);
    this.placeMe(true);
    this.cameras.main.setBounds(0, 0, map.width * T, map.height * T);
    this.cameras.main.startFollow(this.me.c, true, 0.2, 0.2);
    this.fitZoom();
    this.scale.on('resize', () => this.fitZoom());

    // enableCapture=false so typing in DOM inputs (chat, names) still works
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;

    store.on('pos', (teleport: boolean) => this.placeMe(teleport));
    store.on('world', () => this.syncWorld());
    store.on('self', () => {
      this.updateNpcBubbles();
      this.updateTrainers();
      if (store.self) this.me.name.setText(store.self.name);
    });
    this.updateNpcBubbles();
  }

  private fitZoom() {
    const h = this.scale.height, w = this.scale.width;
    const zoom = Math.max(0.75, Math.min(2.5, Math.min(h / (15 * T), w / (19 * T))));
    this.cameras.main.setZoom(zoom);
  }

  // ------------------------------------------------------------ static map

  private drawMap() {
    const { map } = store;
    const g = this.make.graphics({}, false);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) this.drawTile(g, x, y, map.tile(x, y), map.zoneAt(x, y));
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

  private drawTile(g: Phaser.GameObjects.Graphics, x: number, y: number, t: string, zone: ZoneDef | null) {
    const px = x * T, py = y * T;
    const ground = col(zone?.groundColor ?? '#777777');
    const grass = col(zone?.grassColor ?? '#557755');
    const groundTile = () => {
      g.fillStyle(ground, 1).fillRect(px, py, T, T);
      for (let i = 0; i < 3; i++) {
        g.fillStyle(shade(ground, rnd(x, y, i) > 0.5 ? 0.12 : -0.12), 1);
        g.fillRect(px + rnd(x, y, i + 10) * (T - 4), py + rnd(x, y, i + 20) * (T - 4), 3, 3);
      }
    };
    switch (t) {
      case ',': {
        g.fillStyle(grass, 1).fillRect(px, py, T, T);
        const dark = shade(grass, -0.3), light = shade(grass, 0.18);
        for (let i = 0; i < 5; i++) {
          const bx = px + 3 + rnd(x, y, i) * (T - 10), by = py + 8 + rnd(x, y, i + 5) * (T - 12);
          g.fillStyle(i % 2 ? dark : light, 1);
          g.fillTriangle(bx, by + 8, bx + 3, by - 2, bx + 6, by + 8);
        }
        break;
      }
      case '=': {
        g.fillStyle(0xd8b878, 1).fillRect(px, py, T, T);
        g.fillStyle(0xc4a263, 1);
        for (let i = 0; i < 3; i++) g.fillCircle(px + 4 + rnd(x, y, i) * (T - 8), py + 4 + rnd(x, y, i + 3) * (T - 8), 1.5);
        break;
      }
      case ':': {
        g.fillStyle(0x3b2530, 1).fillRect(px, py, T, T);
        g.lineStyle(1, 0x24151d, 1).strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        if (rnd(x, y) > 0.8) { g.fillStyle(0x6e2c3e, 0.7).fillCircle(px + T / 2, py + T / 2, 3); }
        break;
      }
      case 'T': {
        groundTile();
        const canopy = shade(grass, -0.35);
        g.fillStyle(0x000000, 0.2).fillEllipse(px + T / 2, py + T - 4, T * 0.8, 8);
        g.fillStyle(0x6b4a2b, 1).fillRect(px + T / 2 - 3, py + T / 2, 6, T / 2 - 3);
        g.fillStyle(canopy, 1).fillCircle(px + T / 2, py + T / 2 - 2, 12);
        g.fillStyle(shade(canopy, 0.2), 1).fillCircle(px + T / 2 - 4, py + T / 2 - 6, 6);
        break;
      }
      case '^': {
        groundTile();
        const rock = zone?.id === 'cave' ? 0x5d4f78 : 0x8a8a8a;
        g.fillStyle(shade(rock, -0.3), 1);
        g.fillPoints([{ x: px + 3, y: py + T - 3 }, { x: px + 6, y: py + 8 }, { x: px + 16, y: py + 3 }, { x: px + 27, y: py + 9 }, { x: px + T - 3, y: py + T - 3 }], true);
        g.fillStyle(rock, 1);
        g.fillPoints([{ x: px + 7, y: py + T - 6 }, { x: px + 9, y: py + 10 }, { x: px + 16, y: py + 6 }, { x: px + 24, y: py + 11 }, { x: px + 26, y: py + T - 6 }], true);
        break;
      }
      case '~': {
        g.fillStyle(0x2f6fb5, 1).fillRect(px, py, T, T);
        g.lineStyle(2, 0x6fa8e8, 0.8);
        const o = rnd(x, y) * 8;
        g.lineBetween(px + 4 + o, py + 10, px + 12 + o, py + 10);
        g.lineBetween(px + 10 - o / 2, py + 22, px + 20 - o / 2, py + 22);
        break;
      }
      case '#': {
        if (zone?.id === 'arena') {
          g.fillStyle(0x1e141a, 1).fillRect(px, py, T, T);
          g.lineStyle(1, 0x3a2a33, 1);
          g.strokeRect(px + 1, py + 1, T / 2 - 1, T / 2 - 1).strokeRect(px + T / 2, py + 1, T / 2 - 1, T / 2 - 1);
          g.strokeRect(px + 1, py + T / 2, T - 2, T / 2 - 1);
        } else {
          g.fillStyle(col('#d8c8a0'), 1).fillRect(px, py, T, T);
          g.fillStyle(0x8b5e34, 1).fillRect(px, py + 10, T, 4).fillRect(px, py + 20, T, 4);
          g.fillStyle(0x6b4423, 1).fillRect(px + 4, py + 4, 5, T - 6).fillRect(px + T - 9, py + 4, 5, T - 6);
        }
        break;
      }
      case '*': {
        groundTile();
        g.fillStyle(0xb48cff, 0.25).fillCircle(px + T / 2, py + T / 2, 14);
        g.fillStyle(0x9b6bff, 1).fillPoints([{ x: px + 16, y: py + 2 }, { x: px + 24, y: py + 16 }, { x: px + 16, y: py + 30 }, { x: px + 8, y: py + 16 }], true);
        g.fillStyle(0x7fe9ff, 1).fillPoints([{ x: px + 16, y: py + 4 }, { x: px + 20, y: py + 16 }, { x: px + 16, y: py + 18 }], true);
        break;
      }
      default:
        groundTile();
    }
  }

  private drawObjects() {
    const { data } = store;
    const g = this.add.graphics();
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
          g.fillStyle(0x7b4a24, 1).fillRect(cx - 4, cy + 4, 8, 10);
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
          this.label(cx, cy - 25, 'Fusion Lab (E)');
          break;
        }
        case 'npc': {
          const npc = data.quests.npcs[o.id!];
          g.fillStyle(0x000000, 0.25).fillEllipse(cx, cy + 12, 22, 7);
          g.fillStyle(col(npc.color), 1).fillRoundedRect(cx - 9, cy - 2, 18, 15, 5);
          g.fillStyle(0xf2d2b0, 1).fillCircle(cx, cy - 8, 8);
          g.fillStyle(0x222222, 1).fillCircle(cx - 3, cy - 9, 1.5).fillCircle(cx + 3, cy - 9, 1.5);
          this.label(cx, cy + 22, npc.name);
          const bubble = this.add.text(cx, cy - 26, '!', { ...TEXT_STYLE, fontSize: '18px', color: '#ffd84a', fontStyle: 'bold' })
            .setOrigin(0.5).setResolution(2).setDepth(5);
          this.tweens.add({ targets: bubble, y: cy - 30, yoyo: true, repeat: -1, duration: 500 });
          this.npcBubbles.set(o.id!, bubble);
          break;
        }
        case 'sign':
          this.drawSign(g, o);
          break;
        case 'trainer':
          this.drawTrainer(o);
          break;
      }
    }
    const p = data.map.objects.find((o) => o.type === 'portal')!;
    this.portalG = this.add.graphics({ x: p.x * T + T / 2, y: p.y * T + T / 2 });
    this.portalLabel = this.label(p.x * T + T / 2, p.y * T - 6, 'Boss Portal');
  }

  private drawTrainer(o: MapObject) {
    const t = store.data.trainers[o.id!];
    const g = this.add.graphics();
    const c = col(t.color);
    g.fillStyle(0x000000, 0.25).fillEllipse(0, 12, 22, 7);
    g.fillStyle(c, 1).fillRoundedRect(-9, -2, 18, 15, 5);
    g.fillStyle(0xf2d2b0, 1).fillCircle(0, -8, 8);
    // cap
    g.fillStyle(shade(c, -0.35), 1).fillRect(-8, -16, 16, 5);
    const [fx, fy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[t.facing];
    g.fillRect(-8 + (fx > 0 ? 8 : fx < 0 ? -4 : 0), -12, 12, 3);
    g.fillStyle(0x222222, 1).fillCircle(-3 + fx * 2, -8 + fy, 1.5).fillCircle(3 + fx * 2, -8 + fy, 1.5);
    // facing arrow: shows which way they're watching
    g.fillStyle(0xffffff, 0.75).fillTriangle(fx * 18 + fy * 4, fy * 18 + fx * 4, fx * 18 - fy * 4, fy * 18 - fx * 4, fx * 23, fy * 23);
    const label = this.add.text(0, 24, t.name, { ...TEXT_STYLE, color: '#ffd0a0' }).setOrigin(0.5).setResolution(2);
    const cont = this.add.container(o.x * T + T / 2, o.y * T + T / 2, [g, label]).setDepth(7);
    this.trainers.set(o.id!, { c: cont, label });
  }

  private updateTrainers() {
    const beaten = new Set(store.self?.defeatedTrainers ?? []);
    for (const [id, t] of this.trainers) {
      const done = beaten.has(id);
      t.c.setAlpha(done ? 0.55 : 1);
      t.label.setText(store.data.trainers[id].name + (done ? ' (beaten)' : ''));
    }
  }

  private drawSign(g: Phaser.GameObjects.Graphics, o: MapObject) {
    const zone = store.data.zones.find((z) => z.id === o.zone)!;
    const cx = o.x * T + T / 2, cy = o.y * T + T / 2;
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

  // ------------------------------------------------------------ avatars

  private makeAvatar(name: string, color: string, isMe: boolean): Avatar {
    const body = this.add.graphics();
    const nameText = this.add.text(0, -24, name, { ...TEXT_STYLE, color: isMe ? '#ffffff' : '#e8e8e8' }).setOrigin(0.5).setResolution(2);
    const icon = this.add.text(0, -38, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5).setResolution(2);
    const c = this.add.container(0, 0, [body, nameText, icon]).setDepth(isMe ? 11 : 10);
    const a: Avatar = { c, name: nameText, body, icon, tx: 0, ty: 0, state: 'free', connected: true };
    this.paintAvatar(a, color, isMe);
    return a;
  }

  private paintAvatar(a: Avatar, color: string, isMe: boolean) {
    const g = a.body;
    g.clear();
    if (a.state === 'down') {
      g.fillStyle(0x000000, 0.25).fillEllipse(0, 11, 20, 6);
      g.fillStyle(0x9a9a9a, 1).fillRoundedRect(-8, -10, 16, 20, { tl: 8, tr: 8, bl: 1, br: 1 });
      g.fillStyle(0x6b6b6b, 1).fillRect(-1.5, -6, 3, 10).fillRect(-5, -3, 10, 3);
      return;
    }
    g.fillStyle(0x000000, 0.25).fillEllipse(0, 11, 22, 7);
    if (isMe) g.lineStyle(2, 0xffffff, 1).strokeCircle(0, 0, 14);
    g.fillStyle(col(color), 1).fillCircle(0, 0, 11);
    g.lineStyle(2, shade(col(color), -0.5), 1).strokeCircle(0, 0, 11);
    g.fillStyle(0xffffff, 1).fillCircle(-4, -2, 3).fillCircle(4, -2, 3);
    g.fillStyle(0x222222, 1).fillCircle(-4, -1.5, 1.5).fillCircle(4, -1.5, 1.5);
  }

  private placeMe(teleport: boolean) {
    const x = store.pos.x * T + T / 2, y = store.pos.y * T + T / 2;
    this.tweens.killTweensOf(this.me.c);
    if (teleport) this.me.c.setPosition(x, y);
    else this.tweens.add({ targets: this.me.c, x, y, duration: 90 });
    this.onMoved();
  }

  private onMoved() {
    const z = store.map.zoneAt(store.pos.x, store.pos.y);
    if (z && z.id !== this.lastZone) {
      this.lastZone = z.id;
      store.emit('zone', z);
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
      this.applyState(a, p, false);
    }
    for (const [id, a] of this.others) {
      if (!seen.has(id)) { a.c.destroy(); this.others.delete(id); }
    }
    this.syncMarkers();
  }

  private myColor = '';
  private updateMe(p: WorldPlayer) {
    if (p.color !== this.myColor || p.state !== this.me.state) {
      this.myColor = p.color;
      this.applyState(this.me, p, true, true);
    }
  }

  private applyState(a: Avatar, p: WorldPlayer, isMe: boolean, force = false) {
    if (force || a.state !== p.state || a.connected !== p.connected) {
      a.state = p.state;
      a.connected = p.connected;
      this.paintAvatar(a, p.color, isMe);
      a.icon.setText(p.state === 'battle' ? '⚔' : p.state === 'down' ? '💀' : '');
      a.c.setAlpha(p.connected ? 1 : 0.45);
    }
  }

  private syncMarkers() {
    const w = store.world!;
    const live = new Set<string>();
    for (const b of w.battles) {
      if (b.kind === 'boss') continue;
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
    if (document.activeElement instanceof HTMLInputElement) return null;
    if (k.UP.isDown || k.W.isDown) return [0, -1];
    if (k.DOWN.isDown || k.S.isDown) return [0, 1];
    if (k.LEFT.isDown || k.A.isDown) return [-1, 0];
    if (k.RIGHT.isDown || k.D.isDown) return [1, 0];
    return null;
  }

  update(time: number, delta: number) {
    if (store.canMove() && time >= this.nextStepAt) {
      const dir = this.heldDir();
      if (dir) {
        const nx = store.pos.x + dir[0], ny = store.pos.y + dir[1];
        if (store.map.isWalkable(nx, ny)) {
          store.pos = { x: nx, y: ny };
          net.send({ t: 'move', x: nx, y: ny });
          this.nextStepAt = time + store.data.config.moveIntervalMs;
          const tx = nx * T + T / 2, ty = ny * T + T / 2;
          this.tweens.killTweensOf(this.me.c);
          this.tweens.add({ targets: this.me.c, x: tx, y: ty, duration: store.data.config.moveIntervalMs });
          this.onMoved();
        }
      }
    }
    const k = Math.min(1, delta / 90);
    for (const a of this.others.values()) {
      a.c.x += (a.tx - a.c.x) * k;
      a.c.y += (a.ty - a.c.y) * k;
    }
    // Portal glows while a boss fight is running.
    const active = store.world?.boss.phase === 'fight';
    const g = this.portalG;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(time / 250);
    g.fillStyle(active ? 0x9b59b6 : 0x4a3f55, active ? 0.35 + pulse * 0.3 : 0.5).fillEllipse(0, 4, 28, 14);
    g.lineStyle(2, active ? 0xe0b0ff : 0x6d607a, 1).strokeEllipse(0, 4, 28 + (active ? pulse * 6 : 0), 14 + (active ? pulse * 3 : 0));
    this.portalLabel.setText(active ? 'Boss Portal: OPEN' : 'Boss Portal').setColor(active ? '#e0b0ff' : '#cccccc');
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
