import type { GameData } from './types';

// Shared by server (authoritative) and client (preview), so the Fusion Lab always shows the real outcome.

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

/** Fusion result species for two parents, picked by their type pair (order doesn't matter). */
export function fusionResult(data: GameData, speciesA: string, speciesB: string): string | null {
  const ta = data.monsters[speciesA]?.type, tb = data.monsters[speciesB]?.type;
  if (!ta || !tb) return null;
  const key = [ta, tb].sort().join('+');
  return data.fusions.recipes.find((r) => [...r.types].sort().join('+') === key)?.result ?? null;
}

export function fusionLevel(data: GameData, levelA: number, levelB: number): number {
  const lv = Math.round(formula(data.fusions.levelFormula, ['a', 'b'])(levelA, levelB));
  return Math.max(1, Math.min(data.config.progression.maxLevel, lv));
}

export function fusionCost(data: GameData, level: number): number {
  return Math.max(0, Math.round(formula(data.fusions.costFormula, ['level'])(level)));
}

/** Why a monster can't go into the fuser, or null if it can. */
export function fusionBlocker(data: GameData, species: string, level: number): string | null {
  if (data.monsters[species]?.noFusion) return 'too special to fuse';
  if (level < data.fusions.minLevel) return `needs Lv ${data.fusions.minLevel}`;
  return null;
}
