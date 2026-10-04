import type { GameData } from './types';

// Shared by server (authoritative) and client (preview), so the Fusion Lab always shows the real outcome.
//
// Tiers: two monsters of the same tier, both at the tier's required level, fuse into one monster of the
// next tier. Same species keeps its species (a pure upgrade); mixed species follow the type-pair recipes.

const compiled = new Map<string, (...args: number[]) => number>();
function formula(expr: string, vars: string[]): (...args: number[]) => number {
  const key = vars.join(',') + '|' + expr;
  let fn = compiled.get(key);
  if (!fn) {
    fn = new Function(...vars, `"use strict"; return (${expr});`) as (...args: number[]) => number;
    compiled.set(key, fn);
  }
  return fn;
}

export interface FusionParent { species: string; level: number; tier: number }
export interface FusionPlan { species: string; tier: number; level: number; cost: number }

export const maxTier = (data: GameData) => data.tiers.statMult.length;

/** Level both parents of a given tier need before they can fuse. */
export const fuseLevelFor = (data: GameData, tier: number) => data.tiers.fuseLevel[tier - 1] ?? Infinity;

/**
 * Result species when two parents fuse into `resultTier`:
 * - tiers with their own recipes (★3, ★4) always create that tier's new species for the type pair;
 * - otherwise the same species stays itself, and mixed species use the best recipe list at or below that tier.
 */
export function fusionResult(data: GameData, speciesA: string, speciesB: string, resultTier = 2): string | null {
  const ta = data.monsters[speciesA]?.type, tb = data.monsters[speciesB]?.type;
  if (!ta || !tb) return null;
  const key = [ta, tb].sort().join('+');
  const find = (list?: { types: [string, string]; result: string }[]) => list?.find((r) => [...r.types].sort().join('+') === key)?.result ?? null;
  const tiers = data.fusions.tierRecipes ?? {};
  if (tiers[String(resultTier)]) return find(tiers[String(resultTier)]);
  if (speciesA === speciesB) return speciesA;
  const below = Object.keys(tiers).map(Number).filter((t) => t < resultTier).sort((a, b) => b - a)[0];
  return find(below ? tiers[String(below)] : undefined) ?? find(data.fusions.recipes);
}

/** Why a single monster can't go into the fuser right now, or null if it can. */
export function fusionBlocker(data: GameData, m: FusionParent): string | null {
  if (data.monsters[m.species]?.noFusion) return 'too special to fuse';
  if (m.tier >= maxTier(data)) return 'max tier';
  const need = fuseLevelFor(data, m.tier);
  if (m.level < need) return `needs Lv ${need}`;
  return null;
}

/** The fusion of a and b, or a reason it isn't possible. */
export function planFusion(data: GameData, a: FusionParent, b: FusionParent): FusionPlan | string {
  for (const m of [a, b]) {
    const why = fusionBlocker(data, m);
    if (why) return `${data.monsters[m.species]?.name ?? m.species}: ${why}`;
  }
  if (a.tier !== b.tier) return `Both must be the same tier (★${a.tier} vs ★${b.tier})`;
  const tier = a.tier + 1;
  const species = fusionResult(data, a.species, b.species, tier);
  if (!species) return 'No recipe for that pair';
  const lv = Math.round(formula(data.fusions.levelFormula, ['a', 'b'])(a.level, b.level));
  const level = Math.max(1, Math.min(data.config.progression.maxLevel, lv));
  const cost = Math.max(0, Math.round(formula(data.fusions.costFormula, ['level', 'tier'])(level, tier)));
  return { species, tier, level, cost };
}
