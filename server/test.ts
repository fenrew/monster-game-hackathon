// Headless checks: data integrity, progression, battle rules and a rough boss balance simulation.
// Run with `npm test`.
import assert from 'assert';
import type { ServerMsg } from '../shared/types';
import { Battle, BattleHost, BattleOutcome } from './battle';
import { cfg, data, formulas, validateData, worldMap } from './data';
import { createMonster, gainXp } from './monster';
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

function fakePlayer(id: string, species: string[], level: number): Player {
  return {
    id, token: id, name: id, color: '#fff', ws: { readyState: 1 } as never, disconnectedAt: 0, x: 0, y: 0,
    coins: 0, items: { potion: 5 }, party: species.map((s) => createMonster(s, level)), storage: [], quests: {}, rareLuck: 1,
    down: false, respawnAt: 0, needsStarter: false, uniqueEncounter: null, battle: null, immuneSteps: 0,
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
test('roster is 10-12 monsters over 3 types', () => {
  const n = Object.keys(data.monsters).length;
  assert.ok(n >= 10 && n <= 12, `${n} monsters`);
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
  const m = createMonster('zapling', 5);
  const before = { ...m };
  gainXp(m, 100000);
  assert.ok(m.level > before.level);
  assert.ok(m.maxHp > before.maxHp && m.atk > before.atk);
  assert.ok(m.abilities.includes('thunder_fang'));
  assert.ok(m.abilities.length <= cfg.combat.maxKnownAbilities);
});
test('evolution happens at evolveLevel', () => {
  const m = createMonster('pebblit', 13);
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

// ---------------------------------------------------------------- balance sim

function simulateBoss(bossIdx: number, nPlayers: number, level: number, runs = 60): number {
  let wins = 0;
  const lines = [['zapling', 'drizzlet'], ['pebblit', 'fizzbit'], ['drizzlet', 'cragmole'], ['zapling', 'puddlefin']];
  for (let r = 0; r < runs; r++) {
    const host = new FakeHost();
    const players = Array.from({ length: nPlayers }, (_, i) => fakePlayer('p' + i, lines[(i + r) % lines.length], level));
    const { combatant, state } = Battle.bossCombatant(data.bosses[bossIdx], nPlayers);
    const b = new Battle(host, 'boss', data.zones[0], 0, 0, [combatant]);
    b.boss = state;
    players.forEach((p) => b.addParticipant(p));
    b.start();
    for (let round = 0; round < 80 && !b.ended; round++) {
      const view = (host.messages.filter((m) => m.t === 'battle').pop() as Extract<ServerMsg, { t: 'battle' }>).battle;
      for (const p of players) {
        if (!p.battle) continue;
        const active = p.party.find((m) => m.uid === p.battle!.participants.get(p.id)?.active.uid) ?? p.party[0];
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
const bossLevels = (process.env.BOSS_LEVELS || "10,15,19").split(",").map(Number);
for (let i = 0; i < data.bosses.length; i++) {
  const row = [1, 2, 4, 8].map((n) => `${n}p: ${(simulateBoss(i, n, bossLevels[i]) * 100).toFixed(0).padStart(3)}%`);
  console.log(`  ${data.bosses[i].name.padEnd(18)} (party Lv ${bossLevels[i]})  ${row.join('  ')}`);
}

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
