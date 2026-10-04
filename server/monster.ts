import type { MonsterView } from '../shared/types';
import { cfg, data, formulas } from './data';

/** A monster owned by a player (or a wild monster, until caught). HP persists between fights. */
export interface Monster {
  uid: string;
  species: string;
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

export function computeStats(species: string, level: number) {
  const b = data.monsters[species].base;
  return {
    maxHp: Math.floor((2 * b.hp * level) / 100) + level + 10,
    atk: Math.floor((2 * b.atk * level) / 100) + 5,
    def: Math.floor((2 * b.def * level) / 100) + 5,
    spd: Math.floor((2 * b.spd * level) / 100) + 5,
  };
}

export function createMonster(species: string, level: number): Monster {
  const def = data.monsters[species];
  if (!def) throw new Error(`Unknown monster ${species}`);
  const stats = computeStats(species, level);
  const m: Monster = { uid: newUid(), species, level, xp: 0, hp: stats.maxHp, abilities: [], ...stats };
  for (const l of def.learnset) if (l.level <= level) learn(m, l.ability);
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
  const s = computeStats(m.species, m.level);
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
  if (m.level >= cfg.progression.maxLevel) return events;
  m.xp += amount;
  while (m.level < cfg.progression.maxLevel && m.xp >= xpToNext(m.level)) {
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
  if (m.level >= cfg.progression.maxLevel) m.xp = 0;
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
    level: m.level,
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
