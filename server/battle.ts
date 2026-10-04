import type {
  AbilityDef, BattleAction, BattleKind, BattleView, BossDef, BossMoveDef, ServerMsg, Stages, StatKey, ZoneDef,
} from '../shared/types';
import { cfg, data, formulas } from './data';
import { Monster, monsterName } from './monster';
import type { Player } from './player';

export interface Combatant {
  id: string;
  name: string;
  species: string; // monster id, or boss id
  isBoss: boolean;
  type: string;
  monster: Monster;
  stages: Stages;
  guardMult: number;
}

interface Participant {
  player: Player;
  active: Monster;
  stages: Stages;
  guardMult: number;
  choice: BattleAction | null;
  lastAbility: { abilityId: string; targetId?: string } | null;
  used: Set<string>; // uids of monsters that fought this battle (they share the XP)
}

interface BossState {
  def: BossDef;
  N: number;
  rotation: string[];
  idx: number;
  charging: string | null;
  planned: string | null;
  plannedTelegraphed: boolean;
  atkMult: number;
  extraTargets: number;
  phasesTriggered: Set<number>;
  startedAt: number;
}

export type BattleResult = 'victory' | 'defeat' | 'caught' | 'aborted' | 'empty';

export interface BattleOutcome {
  result: BattleResult;
  defeated: Combatant[];
  participants: { player: Player; uids: string[] }[];
  caughtBy?: Player;
  caught?: Monster;
  summary: string[];
}

export interface BattleHost {
  send(p: Player, msg: ServerMsg): void;
  onPlayerLeft(battle: Battle, p: Player, reason: 'fled' | 'wiped' | 'left', lines: string[]): void;
  onBattleEnd(battle: Battle, outcome: BattleOutcome): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const stageMult = (s = 0) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const clampStage = (s: number) => Math.max(-3, Math.min(3, s));

export function typeEffect(moveType: string, defType: string): number {
  if (data.types[moveType]?.strongAgainst === defType) return cfg.combat.superEffective;
  if (data.types[defType]?.strongAgainst === moveType) return cfg.combat.notEffective;
  return 1;
}

export function calcDamage(o: {
  level: number; atk: number; def: number; power: number; moveType: string; userType: string; targetType: string;
}) {
  const base = (((2 * o.level) / 5 + 2) * o.power * (o.atk / Math.max(1, o.def))) / 50 + 2;
  const eff = typeEffect(o.moveType, o.targetType);
  const stab = o.moveType === o.userType ? cfg.combat.stab : 1;
  const crit = Math.random() < cfg.combat.critChance;
  const dmg = Math.max(1, Math.round(base * eff * stab * (crit ? cfg.combat.critMult : 1) * rand(0.85, 1)));
  return { dmg, eff, crit };
}

function effText(eff: number, crit: boolean) {
  const parts: string[] = [];
  if (crit) parts.push('critical!');
  if (eff > 1) parts.push('super effective');
  if (eff < 1) parts.push('not very effective');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

let battleCounter = 0;

export class Battle {
  readonly id = `b${++battleCounter}`;
  round = 0;
  deadline = 0;
  ended = false;
  readonly participants = new Map<string, Participant>();
  readonly everParticipated = new Set<Player>();
  private log: string[] = [];
  private pendingLog: string[] = [];
  private intent: string | null = null;
  private intentDanger = false;
  boss: BossState | null = null;

  constructor(
    private host: BattleHost,
    readonly kind: BattleKind,
    readonly zone: ZoneDef,
    readonly x: number,
    readonly y: number,
    readonly enemies: Combatant[],
    readonly ownerId: string | null = null,
  ) {}

  static wildCombatant(m: Monster, suffix = ''): Combatant {
    const def = data.monsters[m.species];
    return {
      id: m.uid, name: `Wild ${def.name}${suffix}`, species: m.species, isBoss: false, type: def.type,
      monster: m, stages: {}, guardMult: 1,
    };
  }

  static bossCombatant(def: BossDef, N: number): { combatant: Combatant; state: BossState } {
    const maxHp = Math.max(1, Math.round(formulas.bossHp({ baseHp: def.baseHp, N })));
    const monster: Monster = {
      uid: `boss-${def.id}`, species: def.id, level: def.level, xp: 0, hp: maxHp, maxHp,
      atk: def.stats.atk, def: def.stats.def, spd: def.stats.spd, abilities: [],
    };
    return {
      combatant: { id: monster.uid, name: def.name, species: def.id, isBoss: true, type: def.type, monster, stages: {}, guardMult: 1 },
      state: {
        def, N, rotation: def.rotation, idx: 0, charging: null, planned: null, plannedTelegraphed: false,
        atkMult: 1, extraTargets: 0, phasesTriggered: new Set(), startedAt: Date.now(),
      },
    };
  }

  get joinable() {
    return !this.ended && this.kind !== 'unique';
  }

  // ------------------------------------------------------------ membership

  addParticipant(player: Player): boolean {
    if (this.ended || this.participants.has(player.id)) return false;
    const active = player.party.find((m) => m.hp > 0);
    if (!active) return false;
    this.participants.set(player.id, {
      player, active, stages: {}, guardMult: 1, choice: null, lastAbility: null, used: new Set([active.uid]),
    });
    this.everParticipated.add(player);
    player.battle = this;
    if (this.round > 0) this.pendingLog.push(`${player.name} joined the fight with ${monsterName(active)}!`);
    // First fighter into a fight that was waiting empty (a boss nobody could enter yet) gets a full round.
    if (this.round > 0 && this.participants.size === 1) this.deadline = Date.now() + cfg.combat.roundSeconds * 1000;
    return true;
  }

  removeParticipant(player: Player, reason: 'fled' | 'wiped' | 'left', lines: string[] = []) {
    if (!this.participants.delete(player.id)) return;
    player.battle = null;
    this.host.onPlayerLeft(this, player, reason, lines);
  }

  start() {
    this.startRound();
  }

  // ------------------------------------------------------------ choices

  choose(player: Player, action: BattleAction): string | null {
    const p = this.participants.get(player.id);
    if (!p || this.ended) return 'You are not in this fight.';
    const err = this.validate(p, action);
    if (err) return err;
    p.choice = action;
    this.broadcast();
    return null;
  }

  private validate(p: Participant, a: BattleAction): string | null {
    switch (a.kind) {
      case 'ability':
        return p.active.abilities.includes(a.abilityId) && data.abilities[a.abilityId] ? null : 'Unknown ability.';
      case 'item': {
        const item = data.items[a.itemId];
        if (!item || (p.player.items[a.itemId] ?? 0) <= 0) return "You don't have that item.";
        if (item.kind === 'orb') {
          if (this.kind === 'boss') return "Bosses can't be caught!";
          if (!this.enemies.some((e) => e.monster.hp > 0)) return 'Nothing to catch.';
        }
        if (item.kind === 'revive' && !p.player.party.some((m) => m.hp <= 0)) return 'No fainted monsters to revive.';
        return null;
      }
      case 'swap': {
        const m = p.player.party.find((m) => m.uid === a.uid);
        if (!m || m.hp <= 0) return "That monster can't fight.";
        if (m === p.active) return 'Already in battle.';
        return null;
      }
      case 'flee':
        return this.kind === 'boss' ? "You can't flee from a boss!" : null;
    }
    return 'Invalid action.';
  }

  private defaultAction(p: Participant): BattleAction {
    const last = p.lastAbility;
    if (last && p.active.abilities.includes(last.abilityId)) return { kind: 'ability', abilityId: last.abilityId, targetId: last.targetId };
    // No previous ability (first round, or just swapped in): use the strongest attack.
    const strongest = [...p.active.abilities].sort((a, b) => data.abilities[b].power - data.abilities[a].power)[0];
    return { kind: 'ability', abilityId: strongest };
  }

  private actionLabel(p: Participant, a: BattleAction): string {
    switch (a.kind) {
      case 'ability': {
        const ab = data.abilities[a.abilityId];
        const target = ab.target === 'enemy' ? this.findTarget(a.targetId) : null;
        return ab.name + (target ? ` → ${target.name}` : '');
      }
      case 'item': return `Use ${data.items[a.itemId].name}`;
      case 'swap': return `Swap to ${monsterName(p.player.party.find((m) => m.uid === a.uid)!)}`;
      case 'flee': return 'Flee';
    }
  }

  // ------------------------------------------------------------ rounds

  tick(now: number) {
    if (this.ended) return;
    if (this.boss && now - this.boss.startedAt > cfg.boss.timeLimitSeconds * 1000) {
      this.log = [`${this.boss.def.name} grows bored and retreats into the void... the fight is lost.`];
      this.end('defeat');
      return;
    }
    if (this.participants.size === 0) {
      // A boss nobody could enter yet waits for players arriving through the portal.
      if (this.kind === 'boss' && this.everParticipated.size === 0) return;
      this.end(this.kind === 'boss' ? 'defeat' : 'empty');
      return;
    }
    // Disconnected players never block a round, but a fight with nobody connected waits out the timer.
    const parts = [...this.participants.values()];
    const allChosen = parts.every((p) => p.choice || !p.player.ws) && parts.some((p) => p.player.ws);
    if (now >= this.deadline || allChosen) this.resolve();
  }

  private startRound() {
    this.round++;
    this.deadline = Date.now() + cfg.combat.roundSeconds * 1000;
    for (const p of this.participants.values()) {
      p.choice = null;
      p.player.dirty = true; // HP/items changed: refresh their sidebar
    }
    this.intent = null;
    this.intentDanger = false;
    if (this.boss) this.planBoss();
    this.log = [...this.log, ...this.pendingLog];
    this.pendingLog = [];
    this.broadcast();
  }

  private planBoss() {
    const b = this.boss!;
    const bossC = this.enemies[0];
    // phase transitions
    b.def.phases.forEach((ph, i) => {
      if (b.phasesTriggered.has(i) || bossC.monster.hp / bossC.monster.maxHp > ph.belowHpPct) return;
      b.phasesTriggered.add(i);
      this.pendingLog.push(`⚠ ${ph.message}`);
      if (ph.rotation) { b.rotation = ph.rotation; b.idx = 0; }
      if (ph.atkMult) b.atkMult *= ph.atkMult;
      if (ph.extraTargets) b.extraTargets += ph.extraTargets;
    });
    b.plannedTelegraphed = false;
    if (b.charging) {
      b.planned = b.charging;
      b.plannedTelegraphed = true;
      b.charging = null;
      const mv = b.def.moves[b.planned];
      this.intent = `⚠ ${mv.name.toUpperCase()} strikes ${this.targetText(mv)} THIS ROUND! Guard or Bulwark now!`;
      this.intentDanger = true;
      return;
    }
    const key = b.rotation[b.idx % b.rotation.length];
    b.idx++;
    const mv = b.def.moves[key];
    if (mv.telegraph) {
      b.charging = key;
      b.planned = null;
      this.intent = mv.telegraph;
      this.intentDanger = true;
    } else {
      b.planned = key;
      this.intent = mv.targets === 'self'
        ? `${b.def.name} prepares ${mv.name}.`
        : `${b.def.name} prepares ${mv.name} (${this.targetText(mv)}).`;
    }
  }

  private bossTargetCount(mv: BossMoveDef): number {
    const b = this.boss!;
    if (mv.targets === 'all') return Infinity;
    return Math.max(1, Math.round(formulas.bossTargets({ N: b.N })) + b.extraTargets + (mv.extraTargets ?? 0));
  }

  private targetText(mv: BossMoveDef): string {
    if (mv.targets === 'all') return 'EVERYONE';
    const n = this.bossTargetCount(mv);
    return n === 1 ? '1 target' : `${n} targets`;
  }

  private findTarget(id?: string): Combatant | null {
    const alive = this.enemies.filter((e) => e.monster.hp > 0);
    return alive.find((e) => e.id === id) ?? alive[0] ?? null;
  }

  private resolve() {
    const log: string[] = [];
    const parts = [...this.participants.values()];
    for (const p of parts) {
      if (!p.choice) {
        p.choice = this.defaultAction(p);
        // if the default can't be validated (should not happen), fall back to the first ability
        if (this.validate(p, p.choice)) p.choice = { kind: 'ability', abilityId: p.active.abilities[0] };
      }
      p.guardMult = 1;
    }
    for (const e of this.enemies) e.guardMult = 1;
    let playerBulwark = 1;
    let enemyBulwark = 1;

    // 1. Flee
    for (const p of parts) {
      if (p.choice!.kind !== 'flee') continue;
      if (Math.random() < cfg.combat.fleeChance) {
        log.push(`${p.player.name} fled!`);
        this.removeParticipant(p.player, 'fled', [`You got away safely.`]);
      } else {
        log.push(`${p.player.name} tried to flee but couldn't get away!`);
      }
    }
    if (this.participants.size === 0) {
      this.log = log;
      this.end('empty');
      return;
    }

    // 2. Swaps and healing items
    for (const p of this.participants.values()) {
      const a = p.choice!;
      if (a.kind === 'swap') {
        const m = p.player.party.find((m) => m.uid === a.uid);
        if (m && m.hp > 0 && m !== p.active) {
          log.push(`${p.player.name} swapped ${monsterName(p.active)} for ${monsterName(m)}.`);
          p.active = m;
          p.stages = {};
          p.used.add(m.uid);
        }
      } else if (a.kind === 'item') {
        const item = data.items[a.itemId];
        if (item.kind === 'orb' || (p.player.items[a.itemId] ?? 0) <= 0) continue;
        if (item.kind === 'heal') {
          const before = p.active.hp;
          p.active.hp = Math.min(p.active.maxHp, p.active.hp + Math.ceil(p.active.maxHp * (item.healPct ?? 0.5)));
          this.consume(p.player, a.itemId);
          log.push(`${p.player.name} used a ${item.name}: ${monsterName(p.active)} +${p.active.hp - before} HP.`);
        } else if (item.kind === 'revive') {
          const m = p.player.party.find((m) => m.uid === a.targetId && m.hp <= 0) ?? p.player.party.find((m) => m.hp <= 0);
          if (m) {
            m.hp = Math.max(1, Math.floor(m.maxHp * (item.healPct ?? 0.5)));
            this.consume(p.player, a.itemId);
            log.push(`${p.player.name} revived ${monsterName(m)}!`);
          }
        }
      }
    }

    // 3. Abilities, orbs and enemy moves in priority/speed order
    type Entry =
      | { side: 'player'; p: Participant; priority: number; speed: number; tie: number }
      | { side: 'enemy'; e: Combatant; priority: number; speed: number; tie: number };
    const queue: Entry[] = [];
    for (const p of this.participants.values()) {
      const a = p.choice!;
      if (a.kind === 'ability') {
        queue.push({ side: 'player', p, priority: data.abilities[a.abilityId].priority ?? 0, speed: p.active.spd * stageMult(p.stages.spd), tie: Math.random() });
      } else if (a.kind === 'item' && data.items[a.itemId].kind === 'orb') {
        queue.push({ side: 'player', p, priority: 0, speed: p.active.spd * stageMult(p.stages.spd), tie: Math.random() });
      }
    }
    for (const e of this.enemies) {
      if (e.monster.hp <= 0) continue;
      queue.push({ side: 'enemy', e, priority: 0, speed: e.monster.spd * stageMult(e.stages.spd), tie: Math.random() });
    }
    queue.sort((a, b) => b.priority - a.priority || b.speed - a.speed || a.tie - b.tie);

    let caughtBy: Participant | null = null;
    let caught: Combatant | null = null;

    const aliveParticipants = () => [...this.participants.values()].filter((p) => p.active.hp > 0);
    const hitPlayer = (p: Participant, dmg: number) => {
      const final = Math.max(1, Math.round(dmg * p.guardMult * playerBulwark));
      p.active.hp = Math.max(0, p.active.hp - final);
      return final;
    };

    for (const entry of queue) {
      if (caught) break;
      if (entry.side === 'player') {
        const p = entry.p;
        if (!this.participants.has(p.player.id) || p.active.hp <= 0) continue;
        const a = p.choice!;
        const who = `${p.player.name}'s ${monsterName(p.active)}`;
        if (a.kind === 'item') {
          // Orb throw, resolved in speed order: the first successful catch wins.
          const item = data.items[a.itemId];
          const target = this.findTarget(a.targetId);
          if (!target || (p.player.items[a.itemId] ?? 0) <= 0) continue;
          this.consume(p.player, a.itemId);
          const def = data.monsters[target.species];
          const chance = Math.max(0, Math.min(1, formulas.catchChance({
            catchRate: def.catchRate, orbMult: item.catchMult ?? 1, hp: target.monster.hp, maxHp: target.monster.maxHp,
          })));
          if (Math.random() < chance) {
            log.push(`${p.player.name} threw a ${item.name}... gotcha! ${def.name} was caught!`);
            caughtBy = p;
            caught = target;
          } else {
            log.push(`${p.player.name} threw a ${item.name}... ${def.name} broke free!`);
          }
          continue;
        }
        if (a.kind !== 'ability') continue;
        const ab = data.abilities[a.abilityId];
        p.lastAbility = { abilityId: a.abilityId, targetId: a.targetId };
        const userType = data.monsters[p.active.species].type;
        const atk = p.active.atk * stageMult(p.stages.atk);
        if (ab.target === 'self' || ab.target === 'team') {
          const team = ab.target === 'self' ? [p] : aliveParticipants();
          const effects: string[] = [];
          if (ab.guard !== undefined) { p.guardMult = Math.min(p.guardMult, ab.guard); effects.push('braces for impact'); }
          if (ab.bulwark !== undefined) { playerBulwark = Math.min(playerBulwark, ab.bulwark); effects.push('shields the whole team'); }
          if (ab.healPct) {
            for (const t of team) t.active.hp = Math.min(t.active.maxHp, t.active.hp + Math.ceil(t.active.maxHp * ab.healPct));
            effects.push(ab.target === 'team' ? 'heals the team' : 'recovers HP');
          }
          if (ab.buff) {
            for (const t of team) applyStages(t.stages, ab.buff);
            effects.push(`raises ${ab.target === 'team' ? "the team's" : 'its'} ${Object.keys(ab.buff).join('/')}`);
          }
          log.push(`${who} used ${ab.name} and ${effects.join(', ') || 'nothing happens'}.`);
          continue;
        }
        const targets = ab.target === 'allEnemies'
          ? this.enemies.filter((e) => e.monster.hp > 0)
          : [this.findTarget(a.targetId)].filter((t): t is Combatant => !!t);
        if (!targets.length) continue;
        const results: string[] = [];
        for (const t of targets) {
          if (Math.random() > ab.accuracy) { results.push(`missed ${t.name}`); continue; }
          if (ab.debuff) applyStages(t.stages, ab.debuff);
          if (ab.power <= 0) { results.push(`${t.name}'s ${Object.keys(ab.debuff ?? {}).join('/')} fell`); continue; }
          const r = calcDamage({
            level: p.active.level, atk, def: t.monster.def * stageMult(t.stages.def), power: ab.power,
            moveType: ab.type, userType, targetType: t.type,
          });
          const dmg = Math.max(1, Math.round(r.dmg * t.guardMult * enemyBulwark));
          t.monster.hp = Math.max(0, t.monster.hp - dmg);
          results.push(`${t.name} -${dmg}${effText(r.eff, r.crit)}${t.monster.hp <= 0 ? ' and it fainted!' : ''}`);
        }
        log.push(`${who} used ${ab.name}: ${sentence(results)}`);
      } else {
        const e = entry.e;
        if (e.monster.hp <= 0) continue;
        if (e.isBoss) this.bossAct(e, log, aliveParticipants, hitPlayer);
        else {
          const r = this.wildAct(e, log, aliveParticipants, hitPlayer);
          if (r.bulwark !== undefined) enemyBulwark = Math.min(enemyBulwark, r.bulwark);
        }
      }
      if (this.enemies.every((e) => e.monster.hp <= 0)) break;
    }

    if (caught && caughtBy) {
      this.log = log;
      this.end('caught', caughtBy.player, caught);
      return;
    }

    // 4. Fainted monsters: auto-swap to the next healthy one, or the player is wiped.
    for (const p of [...this.participants.values()]) {
      if (p.active.hp > 0) continue;
      log.push(`${p.player.name}'s ${monsterName(p.active)} fainted!`);
      const next = p.player.party.find((m) => m.hp > 0);
      if (next) {
        p.active = next;
        p.stages = {};
        p.used.add(next.uid);
        if (p.lastAbility && !next.abilities.includes(p.lastAbility.abilityId)) p.lastAbility = null;
        log.push(`${p.player.name} sent out ${monsterName(next)}!`);
      } else {
        log.push(`${p.player.name} has no monsters left and is wiped out!`);
        this.removeParticipant(p.player, 'wiped', [...log, `All your monsters fainted. You will respawn in town in ${cfg.respawnSeconds}s.`]);
      }
    }

    this.log = log;
    if (this.enemies.every((e) => e.monster.hp <= 0)) { this.end('victory'); return; }
    if (this.participants.size === 0) { this.end('defeat'); return; }
    this.startRound();
  }

  private wildAct(
    e: Combatant, log: string[], alive: () => Participant[], hitPlayer: (p: Participant, d: number) => number,
  ): { bulwark?: number } {
    const m = e.monster;
    const hpPct = m.hp / m.maxHp;
    const weights = m.abilities.map((id) => {
      const ab = data.abilities[id];
      if (ab.power > 0) return 3;
      if (ab.guard !== undefined || ab.bulwark !== undefined) return hpPct < 0.4 ? 1.5 : 0.3;
      if (ab.healPct) return hpPct < 0.5 ? 2 : 0.1;
      return 0.6;
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let abilityId = m.abilities[0];
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { abilityId = m.abilities[i]; break; } }
    const ab: AbilityDef = data.abilities[abilityId];
    if (ab.target === 'self' || ab.target === 'team') {
      const team = ab.target === 'self' ? [e] : this.enemies.filter((x) => x.monster.hp > 0);
      if (ab.guard !== undefined) e.guardMult = Math.min(e.guardMult, ab.guard);
      if (ab.healPct) for (const t of team) t.monster.hp = Math.min(t.monster.maxHp, t.monster.hp + Math.ceil(t.monster.maxHp * ab.healPct));
      if (ab.buff) for (const t of team) applyStages(t.stages, ab.buff);
      log.push(`${e.name} used ${ab.name}.`);
      return { bulwark: ab.bulwark };
    }
    const targets = ab.target === 'allEnemies' ? alive() : [pick(alive())].filter(Boolean);
    if (!targets.length) return {};
    const results: string[] = [];
    for (const p of targets) {
      if (Math.random() > ab.accuracy) { results.push(`missed ${monsterName(p.active)}`); continue; }
      if (ab.debuff) applyStages(p.stages, ab.debuff);
      if (ab.power <= 0) { results.push(`${p.player.name}'s ${monsterName(p.active)} is weakened`); continue; }
      const r = calcDamage({
        level: m.level, atk: m.atk * stageMult(e.stages.atk), def: p.active.def * stageMult(p.stages.def),
        power: ab.power, moveType: ab.type, userType: e.type, targetType: data.monsters[p.active.species].type,
      });
      const dmg = hitPlayer(p, r.dmg);
      results.push(`${p.player.name}'s ${monsterName(p.active)} -${dmg}${effText(r.eff, r.crit)}`);
    }
    log.push(`${e.name} used ${ab.name}: ${sentence(results)}`);
    return {};
  }

  private bossAct(
    e: Combatant, log: string[], alive: () => Participant[], hitPlayer: (p: Participant, d: number) => number,
  ) {
    const b = this.boss!;
    if (!b.planned) {
      log.push(`${b.def.name} is gathering power...`);
      return;
    }
    const mv = b.def.moves[b.planned];
    if (mv.targets === 'self') {
      const heal = Math.ceil(e.monster.maxHp * (mv.healPct ?? 0));
      e.monster.hp = Math.min(e.monster.maxHp, e.monster.hp + heal);
      log.push(`${b.def.name} used ${mv.name} and recovered ${heal} HP!`);
      return;
    }
    const pool = alive();
    const count = Math.min(pool.length, this.bossTargetCount(mv));
    const targets = shuffle([...pool]).slice(0, count);
    const results: string[] = [];
    for (const p of targets) {
      if (Math.random() > mv.accuracy) { results.push(`missed ${p.player.name}`); continue; }
      if (mv.debuff) applyStages(p.stages, mv.debuff);
      const r = calcDamage({
        level: e.monster.level, atk: e.monster.atk * b.atkMult * stageMult(e.stages.atk),
        def: p.active.def * stageMult(p.stages.def), power: mv.power, moveType: mv.type, userType: e.type,
        targetType: data.monsters[p.active.species].type,
      });
      const dmg = hitPlayer(p, r.dmg);
      results.push(`${p.player.name} -${dmg}${effText(r.eff, r.crit)}`);
    }
    log.push(`${b.def.name} used ${mv.name}${mv.targets === 'all' ? ' on everyone' : ''}: ${sentence(results)}`);
  }

  private consume(player: Player, itemId: string) {
    player.items[itemId] = Math.max(0, (player.items[itemId] ?? 0) - 1);
    if (player.items[itemId] === 0) delete player.items[itemId];
    player.dirty = true;
  }

  // ------------------------------------------------------------ ending

  end(result: BattleResult, caughtBy?: Player, caught?: Combatant) {
    if (this.ended) return;
    this.ended = true;
    const outcome: BattleOutcome = {
      result,
      defeated: this.enemies.filter((e) => e.monster.hp <= 0),
      participants: [...this.participants.values()].map((p) => ({ player: p.player, uids: [...p.used] })),
      caughtBy,
      caught: caught?.monster,
      summary: this.log,
    };
    for (const p of this.participants.values()) p.player.battle = null;
    this.participants.clear();
    this.host.onBattleEnd(this, outcome);
  }

  /** Ends the fight with no rewards (e.g. a boss is starting). */
  abort() {
    this.log = ['The fight was interrupted!'];
    this.end('aborted');
  }

  // ------------------------------------------------------------ views

  broadcast() {
    for (const p of this.participants.values()) this.host.send(p.player, { t: 'battle', battle: this.viewFor(p) });
  }

  private viewFor(p: Participant): BattleView {
    return {
      id: this.id,
      kind: this.kind,
      zoneName: this.zone.name,
      round: this.round,
      remainingMs: Math.max(0, this.deadline - Date.now()),
      roundMs: cfg.combat.roundSeconds * 1000,
      enemies: this.enemies.map((e) => ({
        id: e.id, name: e.name, species: e.species, isBoss: e.isBoss, type: e.type, level: e.monster.level,
        hp: e.monster.hp, maxHp: e.monster.maxHp, fainted: e.monster.hp <= 0,
      })),
      participants: [...this.participants.values()].map((q) => ({
        playerId: q.player.id, name: q.player.name, color: q.player.color, monsterName: monsterName(q.active),
        species: q.active.species, level: q.active.level, hp: q.active.hp, maxHp: q.active.maxHp,
        chosen: !!q.choice, connected: !!q.player.ws,
      })),
      intent: this.intent,
      intentDanger: this.intentDanger,
      log: this.log,
      you: {
        activeUid: p.active.uid,
        chosen: !!p.choice,
        choiceLabel: p.choice ? this.actionLabel(p, p.choice) : null,
        defaultLabel: this.actionLabel(p, this.defaultAction(p)),
      },
    };
  }
}

/** Joins hit results into one log sentence without doubling punctuation. */
function sentence(parts: string[]): string {
  const s = parts.join('; ');
  return /[.!?]$/.test(s) ? s : s + '.';
}

function applyStages(stages: Stages, delta: Stages) {
  for (const k of Object.keys(delta) as StatKey[]) stages[k] = clampStage((stages[k] ?? 0) + (delta[k] ?? 0));
}
