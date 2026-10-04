import type WebSocket from 'ws';
import type { QuestProgress, SelfState } from '../shared/types';
import type { Battle } from './battle';
import type { Duel } from './duel';
import { cfg } from './data';
import { createMonster, Monster, viewMonster } from './monster';

export interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  ws: WebSocket | null;
  disconnectedAt: number;
  x: number;
  y: number;
  coins: number;
  items: Record<string, number>;
  party: Monster[];
  storage: Monster[];
  quests: Record<string, QuestProgress>;
  rareLuck: number;
  down: boolean;
  respawnAt: number;
  needsStarter: boolean;
  uniqueEncounter: { monster: string; level: number; zone: string; tier?: number } | null;
  defeatedTrainers: Set<string>;
  augments: string[];
  augmentOffer: { options: string[]; rerolls: number; rarity: string } | null;
  offerQueue: number[]; // boss indices whose power pick is still waiting
  battle: Battle | Duel | null;
  bossLockUntil: number;
  immuneSteps: number;
  lastMoveAt: number;
  moveBudget: number;
  lastChatAt: number;
  dirty: boolean;
}

/** Resets everything a run grants, so the next run starts fresh. */
export function resetProgress(p: Player) {
  p.coins = cfg.start.coins;
  p.items = { ...cfg.start.items };
  p.party = [];
  p.storage = [];
  p.quests = {};
  p.rareLuck = 1;
  p.down = false;
  p.respawnAt = 0;
  p.needsStarter = true;
  p.uniqueEncounter = null;
  p.defeatedTrainers = new Set();
  p.augments = [];
  p.augmentOffer = null;
  p.offerQueue = [];
  p.bossLockUntil = 0;
  p.immuneSteps = 0;
  p.dirty = true;
}

export function giveStarter(p: Player, species: string) {
  p.party = [createMonster(species, cfg.start.starterLevel)];
  p.needsStarter = false;
  p.dirty = true;
}

/** Adds a monster to the party, or to storage if the party is full. Returns where it went. */
export function addMonster(p: Player, m: Monster): 'party' | 'storage' {
  p.dirty = true;
  if (p.party.length < cfg.party.maxSize) {
    p.party.push(m);
    return 'party';
  }
  p.storage.push(m);
  return 'storage';
}

export const allMonsters = (p: Player) => [...p.party, ...p.storage];

export function selfState(p: Player): SelfState {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    coins: p.coins,
    items: { ...p.items },
    party: p.party.map(viewMonster),
    storage: p.storage.map(viewMonster),
    quests: p.quests,
    rareLuck: p.rareLuck,
    down: p.down,
    respawnAt: p.respawnAt,
    needsStarter: p.needsStarter,
    uniqueEncounter: p.uniqueEncounter,
    inBattle: p.battle?.id ?? null,
    defeatedTrainers: [...p.defeatedTrainers],
    augments: [...p.augments],
    augmentOffer: p.augmentOffer ? { ...p.augmentOffer, queued: p.offerQueue.length } : null,
    bossLockUntil: p.bossLockUntil,
  };
}
