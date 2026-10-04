import type { MapDef, MapObject, ZoneDef } from './types';

/** Object types that occupy their tile. */
const BLOCKING_OBJECTS = new Set(['heal', 'shop', 'npc', 'sign']);

/** Fast lookups over the shared map + zone data; used identically by server and client. */
export class WorldMap {
  readonly width: number;
  readonly height: number;
  private zoneGrid: (ZoneDef | null)[];
  private blockedObjects = new Set<string>();

  constructor(readonly def: MapDef, readonly zones: ZoneDef[]) {
    this.width = def.width;
    this.height = def.height;
    this.zoneGrid = new Array(this.width * this.height).fill(null);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.zoneGrid[y * this.width + x] =
          zones.find((z) => z.rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh)) ?? null;
      }
    }
    for (const o of def.objects) if (BLOCKING_OBJECTS.has(o.type)) this.blockedObjects.add(o.x + ',' + o.y);
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  tile(x: number, y: number): string {
    return this.inBounds(x, y) ? this.def.rows[y][x] : '#';
  }

  zoneAt(x: number, y: number): ZoneDef | null {
    return this.inBounds(x, y) ? this.zoneGrid[y * this.width + x] : null;
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.blockedObjects.has(x + ',' + y)) return false;
    return !!this.def.legend[this.tile(x, y)]?.walkable;
  }

  isGrass(x: number, y: number): boolean {
    return !!this.def.legend[this.tile(x, y)]?.grass;
  }

  /** True if stepping on this tile can trigger a wild encounter. */
  canEncounter(x: number, y: number): boolean {
    const z = this.zoneAt(x, y);
    if (!z || z.kind === 'safe' || z.kind === 'arena') return false;
    if (z.hotspot) return this.isWalkable(x, y);
    return this.isGrass(x, y);
  }

  objectsOfType(type: string): MapObject[] {
    return this.def.objects.filter((o) => o.type === type);
  }

  firstObject(type: string): MapObject {
    const o = this.def.objects.find((o) => o.type === type);
    if (!o) throw new Error(`map has no "${type}" object`);
    return o;
  }

  /** Objects within one tile (including diagonals) of (x, y). */
  objectsNear(x: number, y: number): MapObject[] {
    return this.def.objects.filter((o) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= 1);
  }
}

export function recommendedLabel(rec?: string): string {
  if (!rec) return 'safe';
  if (rec === 'solo') return '👤 solo';
  if (rec === 'everyone') return '👥 everyone';
  return `👥 ${rec} players`;
}

export function zoneLevelLabel(z: ZoneDef): string {
  return z.levelRange ? `Lv ${z.levelRange[0]}-${z.levelRange[1]}` : '';
}
