import type { MonsterView } from '../shared/types';
import { cfg, data, formulas } from './data';

/** A monster owned by a player (or a wild monster, until caught). HP persists between fights. */
export interface Monster {
  uid: string;
  species: string;
  tier: number; // 1-5: multiplies stats and grants stronger moves
  level: number;
  xp: number; // progress towards the next level
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  abilities: string[];
}

let uidCounter = 0;
export const newUid = (prefix = 'm') => `${prefix}${(++uidCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const clampTier = (t = 1) => Math.max(1, Math.min(data.tiers.statMult.length, Math.round(t)));

/** Highest level a monster of this tier can reach. Fuse it into the next tier to go further. */
export const levelCap = (tier: number) => Math.min(cfg.progression.maxLevel, data.tiers.maxLevel[clampTier(tier) - 1] ?? cfg.progression.maxLevel);

/** Lowest tier (at least minTier) whose level cap allows this level: a wild Lv 15 monster is at least ★2. */
export function tierForLevel(level: number, minTier = 1): number {
  let t = clampTier(minTier);
  while (t < data.tiers.statMult.length && level > levelCap(t)) t++;
  return t;
}

export function computeStats(species: string, level: number, tier = 1) {
  const b = data.monsters[species].base;
  const k = data.tiers.statMult[clampTier(tier) - 1];
  return {
    maxHp: Math.floor(((2 * b.hp * level) / 100 + level + 10) * k),
    atk: Math.floor(((2 * b.atk * level) / 100 + 5) * k),
    def: Math.floor(((2 * b.def * level) / 100 + 5) * k),
    spd: Math.floor(((2 * b.spd * level) / 100 + 5) * k),
  };
}

/** Moves granted by reaching each tier up to `tier`, for this monster's type. */
function tierMoves(species: string, tier: number): string[] {
  const type = data.monsters[species].type;
  const out: string[] = [];
  for (let t = 2; t <= tier; t++) out.push(...(data.tiers.moves[String(t)]?.[type] ?? []));
  return out;
}

export function createMonster(species: string, level: number, tier = 1): Monster {
  const def = data.monsters[species];
  if (!def) throw new Error(`Unknown monster ${species}`);
  tier = clampTier(tier);
  level = Math.max(1, Math.min(level, levelCap(tier)));
  const stats = computeStats(species, level, tier);
  const m: Monster = { uid: newUid(), species, tier, level, xp: 0, hp: stats.maxHp, abilities: [], ...stats };
  for (const l of def.learnset) if (l.level <= level) learn(m, l.ability);
  for (const a of tierMoves(species, tier)) learn(m, a);
  return m;
}

export const xpToNext = (level: number) => Math.max(1, Math.round(formulas.xpToNext({ level })));

/** Adds an ability, forgetting the weakest damaging move if over the cap. Returns the forgotten ability, if any. */
function learn(m: Monster, ability: string): string | null {
  if (m.abilities.includes(ability)) return null;
  m.abilities.push(ability);
  if (m.abilities.length <= cfg.combat.maxKnownAbilities) return null;
  const damaging = m.abilities
    .filter((a) => a !== ability && data.abilities[a].power > 0)
    .sort((a, b) => data.abilities[a].power - data.abilities[b].power);
  const forget = damaging[0] ?? m.abilities.find((a) => a !== ability)!;
  m.abilities.splice(m.abilities.indexOf(forget), 1);
  return forget;
}

function recalc(m: Monster) {
  const s = computeStats(m.species, m.level, m.tier);
  const gained = s.maxHp - m.maxHp;
  m.maxHp = s.maxHp;
  m.atk = s.atk;
  m.def = s.def;
  m.spd = s.spd;
  if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.max(0, gained));
}

export const monsterName = (m: Monster) => data.monsters[m.species].name;

/** Gives XP and processes level-ups, new abilities and evolution. Returns human-readable events. */
export function gainXp(m: Monster, amount: number): string[] {
  const events: string[] = [];
  const cap = levelCap(m.tier);
  if (m.level >= cap) { m.xp = 0; return events; }
  m.xp += amount;
  while (m.level < cap && m.xp >= xpToNext(m.level)) {
    m.xp -= xpToNext(m.level);
    m.level++;
    recalc(m);
    events.push(`${monsterName(m)} grew to Lv ${m.level}!`);
    const def = data.monsters[m.species];
    if (def.evolvesTo && def.evolveLevel && m.level >= def.evolveLevel) {
      const before = def.name;
      m.species = def.evolvesTo;
      recalc(m);
      events.push(`${before} evolved into ${monsterName(m)}!`);
    }
    for (const l of data.monsters[m.species].learnset) {
      if (l.level !== m.level || m.abilities.includes(l.ability)) continue;
      const forgot = learn(m, l.ability);
      events.push(`${monsterName(m)} learned ${data.abilities[l.ability].name}!` + (forgot ? ` (forgot ${data.abilities[forgot].name})` : ''));
    }
  }
  if (m.level >= cap) {
    m.xp = 0;
    events.push(`${monsterName(m)} hit the ${'★'.repeat(m.tier)} level cap (Lv ${cap}). Fuse it to go further!`);
  }
  return events;
}

export function healFull(m: Monster) {
  m.hp = m.maxHp;
}

export function viewMonster(m: Monster): MonsterView {
  return {
    uid: m.uid,
    species: m.species,
    name: monsterName(m),
    type: data.monsters[m.species].type,
    tier: m.tier,
    level: m.level,
    maxLevel: levelCap(m.tier),
    xp: m.xp,
    xpToNext: xpToNext(m.level),
    hp: m.hp,
    maxHp: m.maxHp,
    atk: m.atk,
    def: m.def,
    spd: m.spd,
    abilities: [...m.abilities],
  };
}
