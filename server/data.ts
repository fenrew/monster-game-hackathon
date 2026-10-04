import fs from 'fs';
import path from 'path';
import type {
  AbilityDef, BossDef, ConfigFile, GameData, ItemDef, FusionsFile, MapDef, MonsterDef, QuestsFile, TrainerDef, TypeDef, ZoneDef,
} from '../shared/types';
import { WorldMap } from '../shared/map';

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function load<T>(file: string): T {
  const full = path.join(DATA_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
  } catch (e) {
    throw new Error(`Failed to load ${full}: ${(e as Error).message}`);
  }
}

/** Compiles a formula string from config.json, e.g. "baseHp * (1 + 0.6 * (N - 1))". Data files are trusted. */
function formula<K extends string>(expr: string, vars: readonly K[]): (v: Record<K, number>) => number {
  const fn = new Function(...vars, `"use strict"; return (${expr});`) as (...a: number[]) => number;
  return (v) => {
    const r = fn(...vars.map((k) => v[k]));
    if (typeof r !== 'number' || !isFinite(r)) throw new Error(`Formula "${expr}" returned ${r}`);
    return r;
  };
}

export const data: GameData = {
  config: load<ConfigFile>('config.json'),
  types: load<Record<string, TypeDef>>('types.json'),
  abilities: load<Record<string, AbilityDef>>('abilities.json'),
  monsters: load<Record<string, MonsterDef>>('monsters.json'),
  items: load<Record<string, ItemDef>>('items.json'),
  zones: load<ZoneDef[]>('zones.json'),
  map: load<MapDef>('map.json'),
  quests: load<QuestsFile>('quests.json'),
  bosses: load<BossDef[]>('bosses.json'),
  trainers: load<Record<string, TrainerDef>>('trainers.json'),
  fusions: load<FusionsFile>('fusions.json'),
};

export const cfg = data.config;
export const worldMap = new WorldMap(data.map, data.zones);

export const formulas = {
  bossHp: formula(cfg.boss.hpFormula, ['baseHp', 'N'] as const),
  bossTargets: formula(cfg.boss.targetsFormula, ['N'] as const),
  xpToNext: formula(cfg.progression.xpToNextFormula, ['level'] as const),
  xpYield: formula(cfg.progression.xpYieldFormula, ['baseXp', 'enemyLevel'] as const),
  catchChance: formula(cfg.progression.catchFormula, ['catchRate', 'orbMult', 'hp', 'maxHp'] as const),
};

export function zoneById(id: string): ZoneDef {
  const z = data.zones.find((z) => z.id === id);
  if (!z) throw new Error(`Unknown zone ${id}`);
  return z;
}

/** Fails fast on broken references so data edits surface at startup, not mid-game. */
export function validateData(): string[] {
  const errors: string[] = [];
  const { monsters, abilities, items, zones, quests, bosses, types, map } = data;
  const need = (cond: unknown, msg: string) => { if (!cond) errors.push(msg); };

  for (const [id, m] of Object.entries(monsters)) {
    need(types[m.type], `monster ${id}: unknown type ${m.type}`);
    for (const l of m.learnset) need(abilities[l.ability], `monster ${id}: unknown ability ${l.ability}`);
    if (m.evolvesTo) need(monsters[m.evolvesTo], `monster ${id}: evolvesTo unknown ${m.evolvesTo}`);
    if (m.evolvesTo) need(m.evolveLevel, `monster ${id}: evolvesTo without evolveLevel`);
  }
  for (const [id, a] of Object.entries(abilities)) need(types[a.type], `ability ${id}: unknown type ${a.type}`);
  for (const z of zones) {
    for (const e of z.encounters ?? []) need(monsters[e.monster], `zone ${z.id}: unknown monster ${e.monster}`);
    for (const l of z.loot ?? []) need(items[l.item], `zone ${z.id}: unknown item ${l.item}`);
    if (z.kind === 'grass' || z.kind === 'hotspot') {
      need(z.levelRange && z.encounters?.length, `zone ${z.id}: wild zones need levelRange and encounters`);
    }
  }
  for (const s of data.config.start.starters) need(monsters[s], `config: unknown starter ${s}`);
  for (const id of Object.keys(data.config.start.items)) need(items[id], `config: unknown start item ${id}`);
  const questIds = new Set(quests.quests.map((q) => q.id));
  for (const q of quests.quests) {
    need(quests.npcs[q.giver], `quest ${q.id}: unknown giver ${q.giver}`);
    for (const r of q.requires) need(questIds.has(r), `quest ${q.id}: unknown requirement ${r}`);
    for (const id of Object.keys(q.rewards.items ?? {})) need(items[id], `quest ${q.id}: unknown reward item ${id}`);
    if (q.rewards.monster) need(monsters[q.rewards.monster.species], `quest ${q.id}: unknown reward monster`);
    if (q.rewards.uniqueEncounter) need(monsters[q.rewards.uniqueEncounter.monster], `quest ${q.id}: unknown unique monster`);
  }
  for (const b of bosses) {
    for (const r of b.rotation) need(b.moves[r], `boss ${b.id}: rotation uses unknown move ${r}`);
    for (const p of b.phases) for (const r of p.rotation ?? []) need(b.moves[r], `boss ${b.id}: phase uses unknown move ${r}`);
  }
  need(bosses.length >= data.config.boss.bossesToWin, `bosses.json has fewer bosses than bossesToWin`);
  need(map.rows.length === map.height && map.rows.every((r) => r.length === map.width), 'map.json: rows do not match width/height');
  const typeIds = Object.keys(types).filter((t) => t !== 'neutral');
  for (let i = 0; i < typeIds.length; i++) for (let j = i; j < typeIds.length; j++) {
    const key = [typeIds[i], typeIds[j]].sort().join('+');
    need(data.fusions.recipes.some((r) => [...r.types].sort().join('+') === key), `fusions.json: no recipe for ${key}`);
  }
  for (const r of data.fusions.recipes) need(monsters[r.result], `fusions.json: unknown result ${r.result}`);
  need(map.objects.some((o) => o.type === 'fusion'), 'map: missing fusion object');
  for (const [id, t] of Object.entries(data.trainers)) {
    need(t.team.length > 0, `trainer ${id}: empty team`);
    for (const m of t.team) need(monsters[m.monster], `trainer ${id}: unknown monster ${m.monster}`);
    for (const it of Object.keys(t.rewards.items ?? {})) need(items[it], `trainer ${id}: unknown reward item ${it}`);
    need(['up', 'down', 'left', 'right'].includes(t.facing), `trainer ${id}: bad facing ${t.facing}`);
    need(map.objects.some((o) => o.type === 'trainer' && o.id === id), `trainer ${id}: not placed on the map`);
  }
  for (const o of map.objects) {
    if (o.type === 'trainer') need(data.trainers[o.id!], `map: unknown trainer ${o.id}`);
    if (o.type === 'npc') need(quests.npcs[o.id!], `map: unknown npc ${o.id}`);
    if (o.type === 'sign') need(zones.some((z) => z.id === o.zone), `map: sign for unknown zone ${o.zone}`);
  }
  for (const t of ['spawn', 'arenaSpawn', 'bossSpot', 'portal']) need(map.objects.some((o) => o.type === t), `map: missing ${t} object`);
  return errors;
}
