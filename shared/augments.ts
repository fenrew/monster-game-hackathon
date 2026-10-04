import type { GameData, GymDef } from './types';

// Powers ("augments") picked after boss fights. Their numeric mods add up across everything a player owns.
// Shared so the client can show the same discounts and bonuses the server applies.

export type ModKey =
  | 'dmg' | 'dmgTaken' | 'spd' | 'crit' | 'catch' | 'xp' | 'coins' | 'heal' | 'lifesteal' | 'bossDmg'
  | 'teamDmg' | 'shopDiscount' | 'fusionDiscount' | 'respawn' | 'openingGuard' | 'partyXp'
  | 'typeDmg_spark' | 'typeDmg_stone' | 'typeDmg_tide';

export type Mods = Partial<Record<ModKey, number>>;

/** Mods from owned powers, plus each gym badge's type bonus (badges = gym leaders in `beaten`). */
export function augmentMods(data: GameData, owned: readonly string[], beaten: Iterable<string> = []): Mods {
  const out: Mods = {};
  for (const g of badgesOf(data, beaten)) {
    const k = `typeDmg_${g.type}` as ModKey;
    out[k] = (out[k] ?? 0) + data.gyms.badgeBonus;
  }
  for (const id of owned) {
    const a = data.augments.augments.find((x) => x.id === id);
    for (const [k, v] of Object.entries(a?.mods ?? {})) out[k as ModKey] = (out[k as ModKey] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Gyms whose leader is among the beaten trainers, i.e. the badges a player holds. */
export function badgesOf(data: GameData, beaten: Iterable<string>): GymDef[] {
  const set = new Set(beaten);
  return data.gyms.gyms.filter((g) => set.has(g.leader));
}

/** The gym a trainer leads, if any. */
export const gymOfLeader = (data: GameData, trainerId: string) => data.gyms.gyms.find((g) => g.leader === trainerId);

export const mod = (m: Mods, k: ModKey) => m[k] ?? 0;

/** Price after a discount mod, never below 1 coin. */
export const discounted = (price: number, discount: number) => Math.max(1, Math.round(price * (1 - Math.min(0.9, discount))));
