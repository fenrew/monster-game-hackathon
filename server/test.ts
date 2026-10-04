// Headless checks: data integrity, progression, battle rules and a rough boss balance simulation.
// Run with `npm test`.
import assert from 'assert';
import type { ServerMsg } from '../shared/types';
import { Battle, BattleHost, BattleOutcome } from './battle';
import { cfg, data, formulas, validateData, worldMap } from './data';
import { createMonster, gainXp, levelCap, tierForLevel } from './monster';
import { planFusion } from '../shared/fusion';
import { augmentMods, badgesOf, mod, ModKey } from '../shared/augments';
import { Duel } from './duel';
import { Game } from './game';
import type { Player } from './player';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

function fakePlayer(id: string, species: string[], level: number, tier = 1): Player {
  return {
    id, token: id, name: id, color: '#fff', ws: { readyState: 1 } as never, disconnectedAt: 0, x: 0, y: 0,
    coins: 0, items: { potion: 5 }, party: species.map((s) => createMonster(s, level, tier)), storage: [], quests: {}, rareLuck: 1,
    down: false, respawnAt: 0, needsStarter: false, uniqueEncounter: null, defeatedTrainers: new Set(), augments: [], augmentOffer: null, offerQueue: [], bossLockUntil: 0, battle: null, immuneSteps: 0,
    lastMoveAt: 0, moveBudget: 3, lastChatAt: 0, dirty: false,
  };
}

class FakeHost implements BattleHost {
  outcome: BattleOutcome | null = null;
  left: { p: Player; reason: string }[] = [];
  messages: ServerMsg[] = [];
  send(_p: Player, msg: ServerMsg) { this.messages.push(msg); }
  onPlayerLeft(_b: Battle, p: Player, reason: string) { this.left.push({ p, reason }); }
  onBattleEnd(_b: Battle, o: BattleOutcome) { this.outcome = o; }
}

/** Forces a round to resolve now, regardless of the timer. */
function resolveRound(b: Battle) {
  b.deadline = 0;
  b.tick(Date.now());
}

console.log('Data');
test('data files validate', () => {
  const errors = validateData();
  assert.deepStrictEqual(errors, []);
});
test('roster has 10+ monsters over 3 types', () => {
  const n = Object.keys(data.monsters).length;
  assert.ok(n >= 10, `${n} monsters`);
  const types = new Set(Object.values(data.monsters).map((m) => m.type));
  assert.strictEqual(types.size, 3);
});
test('type triangle is a cycle', () => {
  const t = data.types;
  assert.strictEqual(t[t[t.spark.strongAgainst!].strongAgainst!].strongAgainst, 'spark');
});
test('every grass zone has tall grass; the hotspot has open tiles', () => {
  for (const z of data.zones.filter((z) => z.kind === 'grass' || z.kind === 'hotspot')) {
    let count = 0;
    for (let y = 0; y < worldMap.height; y++) for (let x = 0; x < worldMap.width; x++) {
      if (worldMap.zoneAt(x, y) === z && worldMap.canEncounter(x, y)) count++;
    }
    assert.ok(count > 20, `${z.id} has only ${count} encounter tiles`);
  }
});
test('formulas compile and give sane numbers', () => {
  assert.strictEqual(formulas.bossHp({ baseHp: 100, N: 1 }), 100);
  assert.strictEqual(Math.round(formulas.bossHp({ baseHp: 100, N: 4 })), 280);
  assert.strictEqual(formulas.bossTargets({ N: 1 }), 1);
  assert.strictEqual(formulas.bossTargets({ N: 9 }), 4);
  const c = formulas.catchChance({ catchRate: 0.5, orbMult: 1, hp: 1, maxHp: 100 });
  assert.ok(c > 0.4 && c < 0.6);
});

console.log('Progression');
test('levelling raises stats and learns abilities on schedule', () => {
  const m = createMonster('zapling', 5, 2); // ★2 so it can pass the ★1 cap
  const before = { ...m };
  gainXp(m, 100000);
  assert.ok(m.level > before.level);
  assert.ok(m.maxHp > before.maxHp && m.atk > before.atk);
  assert.ok(m.abilities.some((a) => data.abilities[a].power >= 90), 'learned its big late-game attack: ' + m.abilities.join(','));
  assert.ok(m.abilities.length <= cfg.combat.maxKnownAbilities);
});
test('evolution happens at evolveLevel', () => {
  const m = createMonster('pebblit', 7);
  const events = gainXp(m, 1000);
  assert.strictEqual(m.species, 'bouldurr');
  assert.ok(events.some((e) => e.includes('evolved')));
});

console.log('Battle rules');
test('idle players repeat their last ability (default action)', () => {
  const host = new FakeHost();
  const p = fakePlayer('a', ['pebblit'], 10);
  const wild = createMonster('zapling', 3);
  wild.maxHp = wild.hp = 9999;
  const b = new Battle(host, 'wild', data.zones.find((z) => z.id === 'meadow')!, 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.start();
  b.choose(p, { kind: 'ability', abilityId: 'harden' });
  resolveRound(b);
  resolveRound(b); // no input this round
  const lastLog = (host.messages.filter((m) => m.t === 'battle').pop() as Extract<ServerMsg, { t: 'battle' }>).battle.log;
  assert.ok(lastLog.some((l) => l.includes('used Harden')), 'expected Harden to be repeated');
});
test('round resolves as soon as everyone has chosen', () => {
  const host = new FakeHost();
  const a = fakePlayer('a', ['zapling'], 10), c = fakePlayer('c', ['zapling'], 10);
  const wild = createMonster('pebblit', 3);
  wild.maxHp = wild.hp = 9999;
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(a);
  b.addParticipant(c);
  b.start();
  b.choose(a, { kind: 'ability', abilityId: 'tackle' });
  b.tick(Date.now());
  assert.strictEqual(b.round, 1, 'should wait for the second player');
  b.choose(c, { kind: 'ability', abilityId: 'tackle' });
  b.tick(Date.now());
  assert.strictEqual(b.round, 2);
});
test('swaps resolve before abilities; flee resolves first', () => {
  const host = new FakeHost();
  const p = fakePlayer('a', ['zapling', 'pebblit'], 10);
  const q = fakePlayer('q', ['zapling'], 10);
  const wild = createMonster('fizzbit', 3);
  wild.maxHp = wild.hp = 9999;
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.addParticipant(q);
  b.start();
  b.choose(p, { kind: 'swap', uid: p.party[1].uid });
  b.choose(q, { kind: 'flee' });
  resolveRound(b);
  const log = (host.messages.filter((m) => m.t === 'battle').pop() as Extract<ServerMsg, { t: 'battle' }>).battle.log;
  const fleeIdx = log.findIndex((l) => l.includes('flee') || l.includes('fled'));
  const swapIdx = log.findIndex((l) => l.includes('swapped'));
  assert.ok(swapIdx >= 0 && fleeIdx >= 0 && fleeIdx < swapIdx, log.join(' | '));
});
test('a successful catch ends the fight and belongs to the thrower', () => {
  const host = new FakeHost();
  const p = fakePlayer('a', ['zapling'], 10);
  p.items = { prism_orb: 50 };
  const wild = createMonster('puddlefin', 2);
  wild.hp = 1;
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.start();
  for (let i = 0; i < 30 && !b.ended; i++) {
    b.choose(p, { kind: 'item', itemId: 'prism_orb', targetId: wild.uid });
    resolveRound(b);
  }
  assert.strictEqual(host.outcome?.result, 'caught');
  assert.strictEqual(host.outcome?.caughtBy, p);
  assert.ok(b.hits.some((x) => x.kind === 'ability' && /% chance/.test(x.text ?? '')), 'orb throw should announce its odds');
  assert.ok(b.hits.some((x) => x.kind === 'info' && x.text === 'Gotcha!'));
});
test('a player whose monsters all faint is wiped', () => {
  const host = new FakeHost();
  const p = fakePlayer('a', ['puddlefin'], 1);
  const wild = createMonster('glimmoth', 25);
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.start();
  for (let i = 0; i < 30 && !b.ended; i++) resolveRound(b);
  assert.ok(host.left.some((l) => l.reason === 'wiped'));
  assert.strictEqual(host.outcome?.result, 'defeat');
});
test('boss targets scale with the player-count snapshot', () => {
  const host = new FakeHost();
  const players = Array.from({ length: 9 }, (_, i) => fakePlayer('p' + i, ['bouldurr'], 30));
  const { combatant, state } = Battle.bossCombatant(data.bosses[0], 9);
  const b = new Battle(host, 'boss', data.zones[0], 0, 0, [combatant]);
  b.boss = state;
  players.forEach((p) => b.addParticipant(p));
  b.start();
  const view = (host.messages.filter((m) => m.t === 'battle').pop() as Extract<ServerMsg, { t: 'battle' }>).battle;
  assert.ok(view.intent?.includes('4 targets'), view.intent ?? '');
});

test('rounds report hits for floating damage numbers', () => {
  const host = new FakeHost();
  const p = fakePlayer('a', ['zapling'], 10);
  const wild = createMonster('drizzlet', 3);
  wild.maxHp = wild.hp = 9999;
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.start();
  b.choose(p, { kind: 'ability', abilityId: 'spark' });
  resolveRound(b);
  const view = (host.messages.filter((m) => m.t === 'battle').pop() as Extract<ServerMsg, { t: 'battle' }>).battle;
  assert.ok(view.hits.some((h) => h.target === wild.uid && (h.kind === 'dmg' || h.kind === 'miss')), JSON.stringify(view.hits));
});
test('trainers send out their team one by one; no fleeing or catching', () => {
  const host = new FakeHost();
  const p = fakePlayer('a', ['bouldurr'], 30);
  p.items = { orb: 3 };
  const def = data.trainers.pip;
  const team = def.team.map((t) => Battle.trainerCombatant(createMonster(t.monster, t.level), def.name));
  const b = new Battle(host, 'trainer', data.zones[2], 0, 0, [team[0]]);
  b.trainer = { id: 'pip', def };
  b.reserve.push(...team.slice(1));
  b.addParticipant(p);
  b.start();
  assert.ok(b.choose(p, { kind: 'flee' }), 'flee should be refused');
  assert.ok(b.choose(p, { kind: 'item', itemId: 'orb', targetId: team[0].id }), 'catching should be refused');
  for (let i = 0; i < 30 && !b.ended; i++) {
    b.choose(p, { kind: 'ability', abilityId: 'boulder_slam' });
    resolveRound(b);
  }
  assert.strictEqual(host.outcome?.result, 'victory');
  assert.strictEqual(host.outcome?.defeated.length, def.team.length);
});

test('the Fusion Lab fuses two same-tier monsters into the next tier, for coins', () => {
  const game = new Game();
  const lab = data.map.objects.find((o) => o.type === 'fusion')!;
  const p = fakePlayer('f', ['zapling', 'drizzlet', 'pebblit', 'pebblit'], 10);
  p.ws = null;
  p.x = lab.x - 1;
  p.y = lab.y;
  game.players.set(p.id, p);
  const fuse = (a: string, b: string) => (game as unknown as { handle(p: Player, m: unknown): void }).handle(p, { t: 'fuse', a, b });
  p.coins = 50;
  fuse(p.party[0].uid, p.party[1].uid);
  assert.strictEqual(p.party.length, 4, 'too poor: nothing should happen');
  p.coins = 1000;
  fuse(p.party[0].uid, p.party[1].uid);
  assert.deepStrictEqual(p.party.map((m) => m.species), ['stormfin', 'pebblit', 'pebblit']);
  assert.strictEqual(p.party[0].tier, 2);
  assert.strictEqual(p.party[0].level, 1, 'fusion output starts at Lv 1');
  assert.strictEqual(p.coins, 1000 - (50 * 2 * 2 - 100));
  // into ★2, the same species keeps its species, one tier up
  fuse(p.party[1].uid, p.party[2].uid);
  assert.deepStrictEqual(p.party.map((m) => `${m.species}${m.tier}`), ['stormfin2', 'pebblit2']);
  // tier-2 stats beat tier-1 stats at the same level
  assert.strictEqual(p.party[1].tier, 2);
  p.x = 0;
  fuse(p.party[0].uid, p.party[1].uid);
  assert.strictEqual(p.party.length, 2, 'away from the lab: nothing should happen');
});
test('fusion needs matching tiers and the tier level', () => {
  const plan = (a: [string, number, number], b: [string, number, number]) =>
    planFusion(data, { species: a[0], level: a[1], tier: a[2] }, { species: b[0], level: b[1], tier: b[2] });
  assert.strictEqual(typeof plan(['zapling', 6, 1], ['zapling', 9, 1]), 'string', 'Lv 6 is below the tier-1 requirement');
  assert.strictEqual(typeof plan(['zapling', 12, 1], ['zapling', 12, 2]), 'string', 'mixed tiers');
  assert.strictEqual(typeof plan(['zapling', 9, 2], ['zapling', 9, 2]), 'string', 'tier 2 needs Lv 10');
  const ok = plan(['zapling', 10, 2], ['pebblit', 11, 2]);
  assert.ok(typeof ok !== 'string' && ok.tier === 3 && ok.species === 'magnetaur' && ok.level === 1, JSON.stringify(ok));
  assert.strictEqual(typeof plan(['zapling', 40, 5], ['zapling', 40, 5]), 'string', 'max tier');
});
test('the frontier gate only opens after the warden\'s quest', () => {
  const game = new Game();
  const gate = data.map.objects.find((o) => o.type === 'gate')!;
  const p = fakePlayer('g', ['zapling'], 10);
  p.ws = null;
  p.x = gate.x - 1;
  p.y = gate.y;
  game.players.set(p.id, p);
  const move = (x: number, y: number) => {
    p.lastMoveAt = 0;
    (game as unknown as { handle(p: Player, m: unknown): void }).handle(p, { t: 'move', x, y });
  };
  move(gate.x, gate.y);
  assert.strictEqual(p.x, gate.x - 1, 'blocked without the quest');
  p.quests[gate.quest!] = { state: 'done', progress: [] };
  move(gate.x, gate.y);
  assert.strictEqual(p.x, gate.x, 'open once the quest is done');
});

test('each tier has a level cap; wild monsters above a cap come as a higher tier', () => {
  const m = createMonster('zapling', 9, 1);
  gainXp(m, 100000);
  assert.strictEqual(m.level, levelCap(1));
  assert.strictEqual(levelCap(1), 10);
  assert.strictEqual(createMonster('zapling', 25, 1).level, 10, 'creation clamps to the cap');
  assert.strictEqual(tierForLevel(15), 2);
  assert.strictEqual(tierForLevel(8), 1);
  assert.strictEqual(tierForLevel(8, 3), 3);
  // higher tiers are much stronger at the same level
  assert.ok(createMonster('zapling', 10, 3).atk >= createMonster('zapling', 10, 1).atk * 1.7);
});
test('healing abilities cause healing fatigue for the rest of the fight', () => {
  const host = new FakeHost();
  const p = fakePlayer('h', ['drizzlet'], 10);
  const mon = p.party[0];
  assert.ok(mon.abilities.includes('mend'));
  mon.maxHp = 10000;
  mon.hp = 10;
  const wild = createMonster('puddlefin', 1);
  wild.maxHp = wild.hp = 9999;
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.start();
  const heals: number[] = [];
  for (let i = 0; i < 3; i++) {
    b.choose(p, { kind: 'ability', abilityId: 'mend' });
    resolveRound(b);
    heals.push(b.hits.filter((x) => x.target === p.id && x.kind === 'heal').reduce((a, x) => a + x.amount, 0));
  }
  assert.ok(heals[1] < heals[0] * 0.7 && heals[2] < heals[1] * 0.7, heals.join(' > '));
});

test('powers: 3 options, one reroll, picking grants the power', () => {
  const game = new Game();
  const p = fakePlayer('a', ['zapling'], 10);
  p.ws = null;
  game.players.set(p.id, p);
  const g = game as unknown as { offerAugments(p: Player, i: number): void; handle(p: Player, m: unknown): void };
  g.offerAugments(p, 2);
  g.offerAugments(p, 2); // a second boss before picking: queued
  const first = p.augmentOffer!;
  assert.strictEqual(first.options.length, data.augments.optionsPerOffer);
  const before = [...first.options];
  g.handle(p, { t: 'augmentReroll' });
  assert.strictEqual(p.augmentOffer!.rerolls, 0);
  assert.notDeepStrictEqual(p.augmentOffer!.options, before);
  g.handle(p, { t: 'augmentReroll' }); // no rerolls left: ignored
  const pickId = p.augmentOffer!.options[0];
  g.handle(p, { t: 'augmentPick', id: pickId });
  assert.deepStrictEqual(p.augments, [pickId]);
  assert.ok(p.augmentOffer && !p.augmentOffer.options.includes(pickId), 'the queued offer follows and never repeats an owned power');
  g.handle(p, { t: 'augmentPick', id: 'not-offered' });
  assert.strictEqual(p.augments.length, 1);
});
test('a damage power makes your monsters hit harder', () => {
  const total = (augments: string[]) => {
    let sum = 0;
    for (let i = 0; i < 300; i++) {
      const host = new FakeHost();
      const p = fakePlayer('a', ['zapling'], 10, 3); // ★3 hits hard enough that +18% isn't lost to rounding
      p.augments = augments;
      const wild = createMonster('pebblit', 5);
      wild.maxHp = wild.hp = 99999;
      const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
      b.addParticipant(p);
      b.start();
      b.choose(p, { kind: 'ability', abilityId: 'tackle' });
      resolveRound(b);
      sum += 99999 - wild.hp;
    }
    return sum;
  };
  const plain = total([]), boosted = total(['glass_cannon']);
  assert.ok(boosted > plain * 1.08, `${boosted} vs ${plain}`);
});

test('beating the elite trainer wins the run', () => {
  const game = new Game();
  const p = fakePlayer('w', ['orogrand', 'orogrand', 'orogrand', 'orogrand', 'orogrand', 'orogrand'], 50, 5);
  p.ws = null;
  game.players.set(p.id, p);
  const g = game as unknown as { startTrainerBattle(p: Player, id: string): Battle | null; bossPhase: string };
  const eliteId = Object.keys(data.trainers).find((k) => data.trainers[k].elite)!;
  const b = g.startTrainerBattle(p, eliteId)!;
  for (const e of [...b.enemies, ...b.reserve]) e.monster.hp = 1;
  for (let i = 0; i < 60 && !b.ended; i++) {
    const act = [...(b.participants.get(p.id)?.active.abilities ?? [])].sort((x, y) => data.abilities[y].power - data.abilities[x].power)[0];
    if (act) b.choose(p, { kind: 'ability', abilityId: act });
    resolveRound(b);
  }
  assert.ok(b.ended, 'the fight should be over');
  assert.strictEqual(g.bossPhase, 'victory');
});
test('gym leaders hand out badges that boost their type', () => {
  const game = new Game();
  const gym = data.gyms.gyms[0];
  const p = fakePlayer('gy', ['orogrand', 'orogrand', 'orogrand'], 50, 5);
  p.ws = null;
  game.players.set(p.id, p);
  const before = mod(augmentMods(data, p.augments, p.defeatedTrainers), `typeDmg_${gym.type}` as ModKey);
  const g = game as unknown as { startTrainerBattle(p: Player, id: string): Battle | null };
  const b = g.startTrainerBattle(p, gym.leader)!;
  for (let i = 0; i < 60 && !b.ended; i++) {
    const act = [...(b.participants.get(p.id)?.active.abilities ?? [])].sort((x, y) => data.abilities[y].power - data.abilities[x].power)[0];
    if (act) b.choose(p, { kind: 'ability', abilityId: act });
    resolveRound(b);
  }
  assert.ok(p.defeatedTrainers.has(gym.leader), 'leader should be beaten');
  assert.deepStrictEqual(badgesOf(data, p.defeatedTrainers).map((x) => x.id), [gym.id]);
  const after = mod(augmentMods(data, p.augments, p.defeatedTrainers), `typeDmg_${gym.type}` as ModKey);
  assert.ok(Math.abs(after - before - data.gyms.badgeBonus) < 1e-9, `${before} -> ${after}`);
});

test('the Champion only accepts challengers holding every badge', () => {
  const game = new Game();
  const eliteId = Object.keys(data.trainers).find((k) => data.trainers[k].elite)!;
  const spot = data.map.objects.find((o) => o.type === 'trainer' && o.id === eliteId)!;
  const p = fakePlayer('cb', ['orogrand'], 50, 5);
  p.ws = null;
  p.x = spot.x - 1; p.y = spot.y;
  game.players.set(p.id, p);
  const g = game as unknown as { handle(p: Player, m: unknown): void };
  g.handle(p, { t: 'challenge', id: eliteId });
  assert.strictEqual(p.battle, null, 'no badges: refused');
  for (const gym of data.gyms.gyms) p.defeatedTrainers.add(gym.leader);
  g.handle(p, { t: 'challenge', id: eliteId });
  assert.ok(p.battle, 'all badges: the fight starts');
});

test('the Champion fields one legendary per challenger and scales with their level', () => {
  const eliteId = Object.keys(data.trainers).find((k) => data.trainers[k].elite)!;
  const def = data.trainers[eliteId];
  assert.ok(def.team.every((t) => (t.tier ?? 1) === data.tiers.statMult.length), 'every Champion monster is ★5');
  const strong = fakePlayer('s', ['orogrand'], 50, 5);
  const team = Battle.trainerTeam(def, strong);
  assert.ok(Math.min(...team.map((c) => c.monster.level)) >= 50 + (def.matchLevel ?? 0), 'levels follow the challenger');
  const host = new FakeHost();
  const b = new Battle(host, 'trainer', data.zones[0], 0, 0, [team[0]]);
  b.trainer = { id: eliteId, def };
  b.reserve.push(...team.slice(1));
  const players = [0, 1, 2].map((i) => fakePlayer('c' + i, ['orogrand'], 50, 5));
  players.forEach((p) => b.addParticipant(p));
  b.start();
  resolveRound(b);
  assert.strictEqual(b.enemies.filter((e) => e.monster.hp > 0).length, 3, 'three challengers face three legendaries');
});

test('bosses cycle forever and come back empowered', () => {
  const def = data.bosses[0];
  const base = Battle.bossCombatant(def, 1, 0).combatant;
  const empowered = Battle.bossCombatant(def, 1, 1).combatant;
  assert.ok(empowered.monster.maxHp > base.monster.maxHp && empowered.monster.atk > base.monster.atk);
  assert.ok(empowered.name.includes('Empowered'));
});

test('drain heals the user; recoil hurts it', () => {
  const run = (abilityId: string) => {
    const host = new FakeHost();
    const p = fakePlayer('d', ['medusurge'], 20, 2);
    const mon = p.party[0];
    if (!mon.abilities.includes(abilityId)) mon.abilities.push(abilityId);
    mon.maxHp = 5000;
    mon.hp = 2500;
    const wild = createMonster('pebblit', 1);
    wild.maxHp = wild.hp = 99999;
    wild.atk = 1;
    const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
    b.addParticipant(p);
    b.start();
    b.choose(p, { kind: 'ability', abilityId });
    resolveRound(b);
    return { mine: b.hits.filter((x) => x.target === p.id), dealt: 99999 - wild.hp };
  };
  const drain = run('aqua_drain');
  assert.ok(drain.dealt === 0 || drain.mine.some((x) => x.kind === 'heal'), 'Aqua Drain should heal when it hits');
  const recoil = run('ion_storm');
  assert.ok(recoil.dealt === 0 || recoil.mine.some((x) => x.kind === 'dmg' && x.amount >= Math.round(recoil.dealt * 0.25) - 1), 'Ion Storm should cause recoil when it hits');
});

test('only 3 potions per fight', () => {
  const host = new FakeHost();
  const p = fakePlayer('pt', ['pebblit'], 10);
  p.items = { potion: 10 };
  p.party[0].maxHp = 5000;
  p.party[0].hp = 100;
  const wild = createMonster('zapling', 1);
  wild.maxHp = wild.hp = 99999;
  const b = new Battle(host, 'wild', data.zones[2], 0, 0, [Battle.wildCombatant(wild)]);
  b.addParticipant(p);
  b.start();
  const errors: (string | null)[] = [];
  for (let i = 0; i < 4; i++) {
    errors.push(b.choose(p, { kind: 'item', itemId: 'potion' }));
    resolveRound(b);
  }
  assert.strictEqual(p.items.potion, 10 - data.config.combat.potionsPerFight);
  assert.ok(errors[3], 'the 4th potion is refused');
});

test('fusing into ★3 and ★4 always creates a new species', () => {
  const plan = (a: string, b: string, tier: number, level: number) => planFusion(data, { species: a, level, tier }, { species: b, level, tier });
  const t3 = plan('pebblit', 'pebblit', 2, 10);
  assert.ok(typeof t3 !== 'string' && t3.species === 'titanox' && t3.tier === 3, JSON.stringify(t3));
  const t4 = plan('drizzlet', 'puddlefin', 3, 13);
  assert.ok(typeof t4 !== 'string' && t4.species === 'thalassor' && t4.tier === 4, JSON.stringify(t4));
  const t5 = plan('thalassor', 'thalassor', 4, 16);
  assert.ok(typeof t5 !== 'string' && t5.species === 'thalassor' && t5.tier === 5, 'into ★5 the same species stays');
  // the new species come with their signature move
  const m = createMonster('voltaron', 1, 4);
  assert.ok(m.abilities.includes('sovereign_bolt'), m.abilities.join(','));
});

test('after a boss fight everyone is healed and two players duel', () => {
  const game = new Game();
  const ws = { readyState: 0, send() {}, close() {} } as never;
  const a = fakePlayer('a', ['zapling', 'pebblit'], 10, 2);
  const b = fakePlayer('b', ['drizzlet', 'cragmole'], 10, 2);
  for (const p of [a, b]) { p.ws = ws; game.players.set(p.id, p); p.party[0].hp = 1; }
  b.down = true;
  const g = game as unknown as { afterBossFight(): void; startDuel(): void; duel: Duel | null; duelAt: number };
  g.afterBossFight();
  assert.ok(!b.down, 'fallen players are back on their feet');
  assert.ok([a, b].every((p) => p.party.every((m) => m.hp === m.maxHp)), 'every team fully healed');
  assert.ok(g.duelAt > 0, 'a duel is scheduled');
  g.startDuel();
  const duel = g.duel!;
  assert.ok(duel && a.battle === duel && b.battle === duel);
  for (let i = 0; i < 200 && !duel.ended; i++) {
    for (const s of duel.sides) {
      const best = [...s.active.abilities].sort((x, y) => data.abilities[y].power - data.abilities[x].power)[0];
      duel.choose(s.player, { kind: 'ability', abilityId: best });
    }
    duel.tick(Date.now());
  }
  assert.ok(duel.ended, 'the duel finishes');
  assert.strictEqual(g.duel, null);
  assert.ok(a.battle === null && b.battle === null);
  assert.ok([a, b].every((p) => p.party.every((m) => m.hp === m.maxHp)), 'healed again after the duel');
  assert.ok(duel.choose(a, { kind: 'flee' }), 'nobody can flee a duel');
});
test('a player wiped in a boss fight is locked out of the portal for a minute', () => {
  const game = new Game();
  const ws = { readyState: 0, send() {}, close() {} } as never;
  const p = fakePlayer('l', ['zapling'], 10);
  const q = fakePlayer('m', ['zapling'], 10);
  for (const x of [p, q]) { x.ws = ws; game.players.set(x.id, x); }
  game.startBoss();
  const g = game as unknown as { handle(p: Player, m: unknown): void };
  const portal = data.map.objects.find((o) => o.type === 'portal')!;
  // q fell in this boss fight a moment ago and has respawned
  q.battle?.removeParticipant(q, 'left');
  q.bossLockUntil = Date.now() + 60000;
  q.x = portal.x - 1; q.y = portal.y; q.lastMoveAt = 0;
  g.handle(q, { t: 'move', x: portal.x, y: portal.y });
  assert.strictEqual(q.battle, null, 'locked out');
  q.bossLockUntil = Date.now() - 1;
  q.x = portal.x - 1; q.y = portal.y; q.lastMoveAt = 0;
  g.handle(q, { t: 'move', x: portal.x, y: portal.y });
  assert.ok(q.battle, 'after the lockout the portal lets them back in');
});

test('higher-tier fusion species evolve too', () => {
  const m = createMonster('titanox', 21, 3);
  const events = gainXp(m, 100000);
  assert.strictEqual(m.species, 'behemox', 'Titanox evolves into Behemox at Lv 22');
  assert.ok(events.some((e) => e.includes('evolved')));
  assert.ok(m.abilities.includes('tectonic_roar'), 'and learns its new move: ' + m.abilities.join(','));
  const v = createMonster('voltaron', 29, 4);
  gainXp(v, 100000);
  assert.strictEqual(v.species, 'zenivolt');
});

// ---------------------------------------------------------------- balance sim

function simulateBoss(bossIdx: number, nPlayers: number, level: number, tier: number, runs = 60): number {
  let wins = 0;
  const lines = [['zapling', 'drizzlet'], ['pebblit', 'fizzbit'], ['drizzlet', 'cragmole'], ['zapling', 'puddlefin']];
  for (let r = 0; r < runs; r++) {
    const host = new FakeHost();
    const players = Array.from({ length: nPlayers }, (_, i) => fakePlayer('p' + i, lines[(i + r) % lines.length], level, tier));
    const { combatant, state } = Battle.bossCombatant(data.bosses[bossIdx], nPlayers);
    const b = new Battle(host, 'boss', data.zones[0], 0, 0, [combatant]);
    b.boss = state;
    players.forEach((p) => b.addParticipant(p));
    b.start();
    for (let round = 0; round < 80 && !b.ended; round++) {
      const view = (host.messages.filter((m) => m.t === 'battle').pop() as Extract<ServerMsg, { t: 'battle' }>).battle;
      for (const p of players) {
        if (!p.battle) continue;
        const active = p.party.find((m) => m.uid === (p.battle as Battle).participants.get(p.id)?.active.uid) ?? p.party[0];
        // Simple sensible AI: defend when the boss telegraphs, potion when low, otherwise hit hardest.
        if (view.intentDanger && view.intent?.includes('THIS ROUND')) {
          const def = active.abilities.find((a) => a === 'bulwark' || a === 'guard' || a === 'aurora_veil');
          if (def) { b.choose(p, { kind: 'ability', abilityId: def }); continue; }
        }
        if (active.hp < active.maxHp * 0.3 && (p.items.potion ?? 0) > 0) { b.choose(p, { kind: 'item', itemId: 'potion' }); continue; }
        const best = [...active.abilities].sort((x, y) => data.abilities[y].power - data.abilities[x].power)[0];
        b.choose(p, { kind: 'ability', abilityId: best });
      }
      resolveRound(b);
    }
    if (host.outcome?.result === 'victory') wins++;
  }
  return wins / runs;
}

console.log('Boss balance (win rate with a simple AI; for tuning bosses.json/config.json)');
// Expected party at each boss: levels and tiers reached by then (override with BOSS_LEVELS / BOSS_TIERS).
const bossLevels = (process.env.BOSS_LEVELS || '9,11,16').split(',').map(Number);
const bossTiers = (process.env.BOSS_TIERS || '1,2,2').split(',').map(Number);
for (let i = 0; i < data.bosses.length; i++) {
  const row = [1, 2, 4, 8].map((n) => `${n}p: ${(simulateBoss(i, n, bossLevels[i], bossTiers[i]) * 100).toFixed(0).padStart(3)}%`);
  console.log(`  ${data.bosses[i].name.padEnd(18)} (party ★${bossTiers[i]} Lv ${bossLevels[i]})  ${row.join('  ')}`);
}

/** A trainer (the Champion by default) fought by n players with `perPlayer` monsters each (they walk in together). */
function simulateElite(nPlayers: number, level: number, tier: number, runs = 50, trainerId?: string, perPlayer = 2): number {
  const eliteId = trainerId ?? Object.keys(data.trainers).find((k) => data.trainers[k].elite)!;
  const def = data.trainers[eliteId];
  // players who reached ★3/★4 by fusing own the new species of that tier
  const lines = tier >= 4 ? [['voltaron', 'thalassor'], ['orogon', 'typhonix'], ['atlantor', 'colossar'], ['voltaron', 'orogon']]
    : tier === 3 ? [['fulgurion', 'abyssion'], ['titanox', 'tempestray'], ['bogulith', 'magnetaur'], ['fulgurion', 'titanox']]
    : tier === 2 ? [['thundrake', 'abyssqual'], ['golemar', 'stormfin'], ['voltgeode', 'bogrock'], ['torrentoad', 'voltail']]
    : [['zapling', 'drizzlet'], ['pebblit', 'fizzbit'], ['drizzlet', 'cragmole'], ['zapling', 'puddlefin']];
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    const host = new FakeHost();
    const evolve = (s: string) => { let x = s; while (data.monsters[x].evolvesTo && level >= (data.monsters[x].evolveLevel ?? 99)) x = data.monsters[x].evolvesTo!; return x; };
    const roster = (i: number) => [...lines[(i + r) % lines.length], ...lines[(i + r + 1) % lines.length], ...lines[(i + r + 2) % lines.length]].slice(0, perPlayer);
    const players = Array.from({ length: nPlayers }, (_, i) => fakePlayer('e' + i, roster(i).map(evolve), level, tier));
    // whoever faces the Champion holds every gym badge
    if (!trainerId) for (const p of players) for (const g of data.gyms.gyms) p.defeatedTrainers.add(g.leader);
    const team = Battle.trainerTeam(def, players[0]);
    const b = new Battle(host, 'trainer', data.zones[0], 0, 0, [team[0]]);
    b.trainer = { id: eliteId, def };
    b.reserve.push(...team.slice(1));
    players.forEach((p) => b.addParticipant(p));
    b.start();
    for (let round = 0; round < 120 && !b.ended; round++) {
      for (const p of players) {
        if (!p.battle) continue;
        const active = p.party.find((m) => m.uid === (p.battle as Battle).participants.get(p.id)?.active.uid) ?? p.party[0];
        if (active.hp < active.maxHp * 0.3 && (p.items.potion ?? 0) > 0) { b.choose(p, { kind: 'item', itemId: 'potion' }); continue; }
        const best = [...active.abilities].sort((x, y) => data.abilities[y].power - data.abilities[x].power)[0];
        b.choose(p, { kind: 'ability', abilityId: best });
      }
      resolveRound(b);
    }
    if (host.outcome?.result === 'victory') wins++;
  }
  return wins / runs;
}
console.log('Gym balance');
const gymParties = (process.env.GYM_PARTIES || '2:12,2:20,3:24').split(',').map((x) => x.split(':').map(Number));
data.gyms.gyms.forEach((gym, i) => {
  const [tier, level] = gymParties[i] ?? gymParties[gymParties.length - 1];
  const row = [1, 2, 4].map((n) => `${n}p: ${(simulateElite(n, level, tier, 50, gym.leader) * 100).toFixed(0).padStart(3)}%`);
  console.log(`  ${data.trainers[gym.leader].name.padEnd(18)} (party ★${tier} Lv ${level})  ${row.join('  ')}`);
});
const eliteName = Object.values(data.trainers).find((t) => t.elite)!.name;
// tier:level:monsters per player
for (const [tier, level, per] of (process.env.ELITE_PARTIES || '5:45:3,5:45:4,5:50:3,5:50:4').split(',').map((x) => x.split(':').map(Number))) {
  const row = [2, 3, 4].map((n) => `${n}p: ${(simulateElite(n, level, tier, 50, undefined, per || 2) * 100).toFixed(0).padStart(3)}%`);
  console.log(`  ${eliteName.padEnd(18)} (${per || 2}× ★${tier} Lv ${level} each)  ${row.join('  ')}`);
}

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
