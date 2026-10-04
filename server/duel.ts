import type { BattleAction, BattleView, Hit, ServerMsg, Stages, StatKey } from '../shared/types';
import { augmentMods, mod } from '../shared/augments';
import { calcDamage, stageMult } from './battle';
import { cfg, data } from './data';
import { Monster, monsterName } from './monster';
import type { Player } from './player';

// A 1v1 player-versus-player fight (after boss fights). Both sides are players; each player sees the
// opponent's active monster as "the enemy", so the normal battle UI works unchanged.

interface Side {
  player: Player;
  active: Monster;
  stages: Stages;
  choice: BattleAction | null;
  lastAbility: string | null;
  guard: number;
  potions: number;
}

/** A hit recorded against a monster; mapped per viewer to "enemy card" or "my card". */
interface DuelHit extends Omit<Hit, 'target'> { uid: string }

export interface DuelHost {
  send(p: Player, msg: ServerMsg): void;
  onDuelEnd(duel: Duel, winner: Player | null, loser: Player | null, log: string[]): void;
}

let duelCounter = 0;
const clampStage = (s: number) => Math.max(-3, Math.min(3, s));
function applyStages(stages: Stages, delta: Stages) {
  for (const k of Object.keys(delta) as StatKey[]) stages[k] = clampStage((stages[k] ?? 0) + (delta[k] ?? 0));
}

export class Duel {
  readonly id = `d${++duelCounter}`;
  readonly kind = 'duel' as const;
  round = 0;
  deadline = 0;
  ended = false;
  readonly sides: [Side, Side];
  private log: string[] = [];
  private hits: DuelHit[] = [];
  private healMult = new Map<string, number>();

  constructor(private host: DuelHost, a: Player, b: Player, readonly x: number, readonly y: number) {
    const side = (p: Player): Side => ({
      player: p, active: p.party.find((m) => m.hp > 0) ?? p.party[0], stages: {}, choice: null, lastAbility: null, guard: 1, potions: 0,
    });
    this.sides = [side(a), side(b)];
    a.battle = this;
    b.battle = this;
  }

  /** Players in the duel (the world state counts them like battle participants). */
  get participants(): Map<string, Player> {
    return new Map(this.sides.map((s) => [s.player.id, s.player]));
  }

  get joinable() {
    return false;
  }

  private sideOf(p: Player) {
    return this.sides.find((s) => s.player === p) ?? null;
  }

  private other(s: Side) {
    return s === this.sides[0] ? this.sides[1] : this.sides[0];
  }

  start() {
    this.log = [`⚔ DUEL: ${this.sides[0].player.name} vs ${this.sides[1].player.name}! Both teams are fully healed. Last monster standing wins.`];
    this.startRound();
  }

  // ------------------------------------------------------------ choices

  choose(p: Player, a: BattleAction): string | null {
    const s = this.sideOf(p);
    if (!s || this.ended) return 'You are not in this duel.';
    switch (a.kind) {
      case 'ability':
        if (!s.active.abilities.includes(a.abilityId)) return 'Unknown ability.';
        break;
      case 'item': {
        const item = data.items[a.itemId];
        if (!item || (p.items[a.itemId] ?? 0) <= 0) return "You don't have that item.";
        if (item.kind !== 'heal') return 'Only healing items can be used in a duel.';
        if (s.potions >= cfg.combat.potionsPerFight) return `You've used all ${cfg.combat.potionsPerFight} potions you can this fight.`;
        break;
      }
      case 'swap': {
        const m = p.party.find((x) => x.uid === a.uid);
        if (!m || m.hp <= 0 || m === s.active) return "That monster can't fight.";
        break;
      }
      case 'flee':
        return "You can't run from a duel!";
    }
    s.choice = a;
    this.broadcast();
    return null;
  }

  private defaultAction(s: Side): BattleAction {
    if (s.lastAbility && s.active.abilities.includes(s.lastAbility)) return { kind: 'ability', abilityId: s.lastAbility };
    const strongest = [...s.active.abilities].sort((x, y) => data.abilities[y].power - data.abilities[x].power)[0];
    return { kind: 'ability', abilityId: strongest };
  }

  private label(s: Side, a: BattleAction) {
    if (a.kind === 'ability') return data.abilities[a.abilityId].name;
    if (a.kind === 'item') return `Use ${data.items[a.itemId].name}`;
    if (a.kind === 'swap') return `Swap to ${monsterName(s.player.party.find((m) => m.uid === a.uid)!)}`;
    return 'Flee';
  }

  // ------------------------------------------------------------ rounds

  tick(now: number) {
    if (this.ended) return;
    const allChosen = this.sides.every((s) => s.choice || !s.player.ws) && this.sides.some((s) => s.player.ws);
    if (now >= this.deadline || allChosen) this.resolve();
  }

  private startRound() {
    this.round++;
    this.deadline = Date.now() + cfg.combat.roundSeconds * 1000;
    for (const s of this.sides) { s.choice = null; s.player.dirty = true; }
    this.broadcast();
  }

  private heal(m: Monster, raw: number, fromAbility: boolean): number {
    const mult = this.healMult.get(m.uid) ?? 1;
    const before = m.hp;
    m.hp = Math.min(m.maxHp, m.hp + Math.max(1, Math.round(raw * mult)));
    if (fromAbility) this.healMult.set(m.uid, mult * cfg.combat.healDecay);
    return m.hp - before;
  }

  private resolve() {
    const log: string[] = [];
    const hits: DuelHit[] = (this.hits = []);
    for (const s of this.sides) {
      if (!s.choice) s.choice = this.defaultAction(s);
      s.guard = 1;
    }
    // swaps and potions first
    for (const s of this.sides) {
      const a = s.choice!;
      if (a.kind === 'swap') {
        const m = s.player.party.find((x) => x.uid === a.uid);
        if (m && m.hp > 0) {
          log.push(`${s.player.name} swapped to ${monsterName(m)}.`);
          s.active = m;
          s.stages = {};
        }
      } else if (a.kind === 'item' && (s.player.items[a.itemId] ?? 0) > 0 && s.potions < cfg.combat.potionsPerFight) {
        const item = data.items[a.itemId];
        const healed = this.heal(s.active, Math.ceil(s.active.maxHp * (item.healPct ?? 0.5)), false);
        s.player.items[a.itemId]--;
        if (s.player.items[a.itemId] <= 0) delete s.player.items[a.itemId];
        s.potions++;
        hits.push({ uid: s.active.uid, amount: healed, kind: 'heal' });
        log.push(`${s.player.name} used a ${item.name}: ${monsterName(s.active)} +${healed} HP.`);
      }
    }
    // abilities by priority, then speed (powers apply in duels too)
    const order = this.sides
      .filter((s) => s.choice!.kind === 'ability')
      .map((s) => {
        const ab = data.abilities[(s.choice as { abilityId: string }).abilityId];
        const spd = s.active.spd * stageMult(s.stages.spd) * (1 + mod(augmentMods(data, s.player.augments, s.player.defeatedTrainers), 'spd'));
        return { s, ab, priority: ab.priority ?? 0, spd, tie: Math.random() };
      })
      .sort((a, b) => b.priority - a.priority || b.spd - a.spd || a.tie - b.tie);
    for (const { s, ab } of order) {
      if (s.active.hp <= 0) continue;
      const foe = this.other(s);
      const pm = augmentMods(data, s.player.augments, s.player.defeatedTrainers);
      s.lastAbility = (s.choice as { abilityId: string }).abilityId;
      const who = `${s.player.name}'s ${monsterName(s.active)}`;
      hits.push({ uid: s.active.uid, amount: 0, kind: 'ability', text: ab.name });
      if (ab.target === 'self' || ab.target === 'team') {
        const fx: string[] = [];
        if (ab.guard !== undefined) { s.guard = Math.min(s.guard, ab.guard); fx.push('braces for impact'); }
        if (ab.bulwark !== undefined) { s.guard = Math.min(s.guard, ab.bulwark); fx.push('raises a shield'); }
        if (ab.healPct) {
          const healed = this.heal(s.active, Math.ceil(s.active.maxHp * ab.healPct), true);
          hits.push({ uid: s.active.uid, amount: healed, kind: 'heal' });
          fx.push(`recovers ${healed} HP`);
        }
        if (ab.buff) { applyStages(s.stages, ab.buff); fx.push(`raises its ${Object.keys(ab.buff).join('/')}`); }
        log.push(`${who} used ${ab.name} and ${fx.join(', ') || 'nothing happens'}.`);
        continue;
      }
      const t = foe.active;
      if (t.hp <= 0) continue;
      if (Math.random() > ab.accuracy) {
        hits.push({ uid: t.uid, amount: 0, kind: 'miss' });
        log.push(`${who} used ${ab.name}, but missed!`);
        continue;
      }
      if (ab.debuff) applyStages(foe.stages, ab.debuff);
      if (ab.power <= 0) { log.push(`${who} used ${ab.name}: ${foe.player.name}'s ${monsterName(t)} is weakened.`); continue; }
      const r = calcDamage({
        level: s.active.level, atk: s.active.atk * stageMult(s.stages.atk), def: t.def * stageMult(foe.stages.def), power: ab.power,
        moveType: ab.type, userType: data.monsters[s.active.species].type, targetType: data.monsters[t.species].type, critBonus: mod(pm, 'crit'),
      });
      const fm = augmentMods(data, foe.player.augments, foe.player.defeatedTrainers);
      const boost = (1 + mod(pm, 'dmg') + mod(pm, `typeDmg_${ab.type}` as keyof typeof pm)) * Math.max(0.1, 1 - mod(fm, 'dmgTaken'));
      const dmg = Math.max(1, Math.round(r.dmg * foe.guard * boost));
      t.hp = Math.max(0, t.hp - dmg);
      hits.push({ uid: t.uid, amount: dmg, kind: 'dmg', crit: r.crit, eff: r.eff });
      const extra: string[] = [];
      if (ab.drain && s.active.hp > 0) {
        const healed = this.heal(s.active, dmg * ab.drain, false);
        hits.push({ uid: s.active.uid, amount: healed, kind: 'heal' });
        extra.push(`drained ${healed} HP`);
      }
      if (ab.recoil) {
        const back = Math.max(1, Math.round(dmg * ab.recoil));
        s.active.hp = Math.max(0, s.active.hp - back);
        hits.push({ uid: s.active.uid, amount: back, kind: 'dmg' });
        extra.push(`took ${back} recoil`);
      }
      log.push(`${who} used ${ab.name}: ${foe.player.name}'s ${monsterName(t)} -${dmg}${r.crit ? ' (critical!)' : ''}${r.eff > 1 ? ' (super effective)' : r.eff < 1 ? ' (not very effective)' : ''}${t.hp <= 0 ? ' and it fainted!' : ''}${extra.length ? '; ' + extra.join('; ') : ''}.`);
    }
    // knocked-out monsters are replaced; a side with nothing left loses
    const out: Side[] = [];
    for (const s of this.sides) {
      if (s.active.hp > 0) continue;
      const next = s.player.party.find((m) => m.hp > 0);
      if (next) {
        s.active = next;
        s.stages = {};
        log.push(`${s.player.name} sends out ${monsterName(next)}!`);
      } else {
        out.push(s);
      }
    }
    this.log = log;
    if (out.length === 2) return this.end(null, log);
    if (out.length === 1) return this.end(this.other(out[0]), log);
    this.startRound();
  }

  private end(winner: Side | null, log: string[]) {
    if (this.ended) return;
    this.ended = true;
    for (const s of this.sides) s.player.battle = null;
    const loser = winner ? this.other(winner) : null;
    this.host.onDuelEnd(this, winner?.player ?? null, loser?.player ?? null, [...log, winner ? `🏆 ${winner.player.name} wins the duel!` : "It's a draw!"]);
  }

  /** A duelist left the game: the other one wins. */
  removeParticipant(p: Player, _reason?: string) {
    const s = this.sideOf(p);
    if (!s || this.ended) return;
    this.end(this.other(s), [`${p.name} left the duel.`]);
  }

  /** A boss is starting: call the duel off. */
  abort() {
    this.end(null, ['The duel was interrupted by a boss!']);
  }

  // ------------------------------------------------------------ views

  broadcast() {
    for (const s of this.sides) this.host.send(s.player, { t: 'battle', battle: this.viewFor(s) });
  }

  private viewFor(me: Side): BattleView {
    const foe = this.other(me);
    const fm = foe.active;
    const def = data.monsters[fm.species];
    return {
      id: this.id,
      kind: 'duel',
      zoneName: 'Boss Arena',
      zoneId: 'arena',
      round: this.round,
      remainingMs: Math.max(0, this.deadline - Date.now()),
      roundMs: cfg.combat.roundSeconds * 1000,
      enemies: [{
        id: fm.uid, name: `${foe.player.name}'s ${def.name}`, species: fm.species, isBoss: false, type: def.type,
        level: fm.level, tier: fm.tier, hp: fm.hp, maxHp: fm.maxHp, fainted: fm.hp <= 0, healMult: this.healMult.get(fm.uid) ?? 1,
      }],
      participants: [{
        playerId: me.player.id, name: me.player.name, color: me.player.color, monsterName: monsterName(me.active),
        species: me.active.species, level: me.active.level, tier: me.active.tier, hp: me.active.hp, maxHp: me.active.maxHp,
        chosen: !!me.choice, connected: !!me.player.ws, healMult: this.healMult.get(me.active.uid) ?? 1,
      }],
      intent: foe.choice ? `${foe.player.name} has locked in a move.` : `${foe.player.name} is choosing a move...`,
      intentDanger: false,
      log: this.log,
      // my monsters' hits land on my card; the opponent's on the enemy card
      hits: this.hits.map((h) => {
        const mine = me.player.party.some((m) => m.uid === h.uid);
        return { ...h, uid: undefined, target: mine ? me.player.id : h.uid } as Hit;
      }),
      trainer: null,
      you: {
        activeUid: me.active.uid,
        chosen: !!me.choice,
        choiceLabel: me.choice ? this.label(me, me.choice) : null,
        defaultLabel: this.label(me, this.defaultAction(me)),
        potionsLeft: Math.max(0, cfg.combat.potionsPerFight - me.potions),
      },
    };
  }
}
