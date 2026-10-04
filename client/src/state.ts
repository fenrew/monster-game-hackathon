import type { BattleView, GameData, SelfState, WorldState } from '../../shared/types';
import { WorldMap } from '../../shared/map';
import { portraitSVG } from './portrait';

type Listener = (...args: any[]) => void;

/** Client-side mirror of what the server has told us, plus a tiny event bus. */
class Store {
  data!: GameData;
  map!: WorldMap;
  myId = '';
  self: SelfState | null = null;
  world: WorldState | null = null;
  serverOffset = 0; // serverNow - Date.now()
  battle: BattleView | null = null;
  battleDeadline = 0; // performance.now() timestamp
  pos = { x: 0, y: 0 };
  modalOpen = false;
  private listeners = new Map<string, Listener[]>();

  setData(d: GameData) {
    this.data = d;
    this.map = new WorldMap(d.map, d.zones);
  }

  on(ev: string, fn: Listener) {
    const l = this.listeners.get(ev) ?? [];
    l.push(fn);
    this.listeners.set(ev, l);
  }

  emit(ev: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(ev) ?? []) fn(...args);
  }

  serverNow() {
    return Date.now() + this.serverOffset;
  }

  canMove() {
    const s = this.self;
    return !!s && !s.needsStarter && !s.down && !s.inBattle && !this.battle && !this.modalOpen;
  }
}

export const store = new Store();

/** Portrait for a monster species (with its tier aura) or a boss id. */
export function portraitFor(species: string, size = 64, tier = 1, animate = size >= 56): string {
  const m = store.data.monsters[species];
  if (m) {
    const aura = tier > 1 ? { tier, color: store.data.tiers.colors[tier - 1] ?? '#ffffff' } : undefined;
    return portraitSVG(species, m.color, size, aura, m.shape, m.art, m.flair, animate);
  }
  const b = store.data.bosses.find((b) => b.id === species);
  return b ? portraitSVG(b.shape, b.color, size) : portraitSVG('rock', '#888888', size);
}

/** ★★★ in the tier's colour. */
export function tierBadge(tier: number): HTMLElement {
  const t = Math.max(1, tier || 1);
  const el = document.createElement('span');
  el.className = `tier t${t}`;
  el.textContent = '★'.repeat(t);
  el.title = `Tier ${t}: ${store.data.tiers.names[t - 1] ?? ''}`;
  el.style.color = store.data.tiers.colors[t - 1] ?? '#fff';
  return el;
}

export function typeChip(type: string): HTMLElement {
  const t = store.data.types[type];
  const el = document.createElement('span');
  el.className = 'type-chip';
  el.style.background = t?.color ?? '#888';
  el.textContent = t?.name ?? type;
  return el;
}
