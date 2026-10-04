import crypto from 'crypto';
import type WebSocket from 'ws';
import type {
  BossClock, ClientMsg, QuestDef, ServerMsg, ToastKind, WorldState, ZoneDef,
} from '../shared/types';
import { augmentMods, badgesOf, discounted, gymOfLeader, mod } from '../shared/augments';
import { planFusion } from '../shared/fusion';
import { Battle, BattleHost, BattleOutcome, bossDisplayName, Combatant } from './battle';
import { Duel, DuelHost } from './duel';
import { cfg, data, formulas, worldMap, zoneById } from './data';
import { computeStats, createMonster, gainXp, healFull, Monster, monsterName, tierForLevel } from './monster';
import { addMonster, allMonsters, giveStarter, Player, resetProgress, selfState } from './player';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#e84393', '#00cec9', '#fd79a8', '#6c5ce7', '#fab1a0'];
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

type QuestEvent =
  | { kind: 'defeat'; zone: string; species: string; type: string }
  | { kind: 'catch'; zone: string; species: string; type: string }
  | { kind: 'trainers' }
  | { kind: 'fuse' }
  | { kind: 'level' }; // re-check "state" objectives (level, tier)

export class Game implements BattleHost, DuelHost {
  readonly players = new Map<string, Player>();
  private byToken = new Map<string, Player>();
  private sockets = new Map<WebSocket, Player>();
  readonly battles = new Set<Battle>();
  private colorIdx = 0;
  private lastTick = Date.now();

  // boss cycle
  private bossPhase: BossClock['phase'] = 'countdown';
  private bossTimerMs = cfg.boss.intervalSeconds * 1000;
  private bossIndex = 0;
  private bossesDefeated = 0;
  private bossLoop = 0;   // completed boss cycles
  private bossFights = 0; // boss fights so far (powers get rarer)
  private duel: Duel | null = null;
  private duelAt = 0; // when the post-boss duel starts
  private bossBattle: Battle | null = null;
  private resetAt = 0;
  private warned = new Set<number>();

  private readonly spawn = worldMap.firstObject('spawn');
  private readonly arenaSpawn = worldMap.firstObject('arenaSpawn');
  private readonly bossSpot = worldMap.firstObject('bossSpot');
  private readonly portals = worldMap.objectsOfType('portal');
  private readonly outpostSpawn = worldMap.objectsOfType('outpostSpawn')[0] ?? null;
  private lastGateToast = new WeakMap<Player, number>();

  start() {
    setInterval(() => this.tick(), cfg.tickMs);
  }

  // ================================================================ connections

  onConnect(ws: WebSocket) {
    this.sendWs(ws, { t: 'hello', data });
  }

  onClose(ws: WebSocket) {
    const p = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (p && p.ws === ws) {
      p.ws = null;
      p.disconnectedAt = Date.now();
    }
  }

  onMessage(ws: WebSocket, raw: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const p = this.sockets.get(ws);
    if (!p) {
      if (msg.t === 'join') this.join(ws, String(msg.name ?? ''), String(msg.starter ?? ''));
      else if (msg.t === 'resume') this.resume(ws, String(msg.token ?? ''));
      return;
    }
    try {
      this.handle(p, msg);
    } catch (e) {
      console.error('Error handling', msg.t, e);
    }
  }

  private handle(p: Player, msg: ClientMsg) {
    switch (msg.t) {
      case 'pickStarter':
        if (p.needsStarter && cfg.start.starters.includes(msg.starter)) {
          giveStarter(p, msg.starter);
          this.toast(p, `${data.monsters[msg.starter].name} joins you! Head out of town and find some tall grass.`, 'good');
        }
        return;
      case 'move': return this.move(p, Number(msg.x), Number(msg.y));
      case 'action': {
        if (!p.battle || !msg.action || typeof msg.action !== 'object') return;
        const err = p.battle.choose(p, msg.action);
        if (err) this.toast(p, err, 'bad');
        return;
      }
      case 'heal': return this.heal(p);
      case 'buy': return this.buy(p, String(msg.item), Number(msg.qty));
      case 'questAccept': return this.acceptQuest(p, String(msg.id));
      case 'questTurnIn': return this.turnInQuest(p, String(msg.id));
      case 'useItem': return this.useItemOutside(p, String(msg.item), String(msg.uid));
      case 'partyLead': return this.partyOp(p, 'lead', String(msg.uid));
      case 'partyStore': return this.partyOp(p, 'store', String(msg.uid));
      case 'partyWithdraw': return this.partyOp(p, 'withdraw', String(msg.uid));
      case 'chat': return this.chat(p, String(msg.text ?? ''));
      case 'fuse': return this.fuse(p, String(msg.a), String(msg.b));
      case 'augmentPick': return this.pickAugment(p, String(msg.id));
      case 'augmentReroll': return this.rerollAugments(p);
      case 'challenge': {
        const id = String(msg.id);
        if (!this.near(p, 'trainer', id) || p.battle || p.down) return;
        if (p.defeatedTrainers.has(id)) return this.toast(p, `${data.trainers[id].name}: "${data.trainers[id].defeat}"`, 'info');
        const missing = this.missingBadges(p, id);
        if (missing.length) {
          return this.toast(p, `${data.trainers[id].name}: "Come back when you hold every gym badge." Missing: ${missing.map((g) => `${g.icon} ${g.badge}`).join(', ')}`, 'bad');
        }
        this.startTrainerBattle(p, id);
        return;
      }
    }
  }

  private join(ws: WebSocket, rawName: string, starter: string) {
    const name = rawName.replace(/[<>&"'`]/g, '').trim().slice(0, 16) || `Trainer${randInt(100, 999)}`;
    if (!cfg.start.starters.includes(starter)) return this.sendWs(ws, { t: 'error', text: 'Pick a starter monster.' });
    const pos = this.spawnPosition();
    const p: Player = {
      id: crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(16).toString('hex'),
      name,
      color: COLORS[this.colorIdx++ % COLORS.length],
      ws,
      disconnectedAt: 0,
      x: pos.x,
      y: pos.y,
      coins: 0, items: {}, party: [], storage: [], quests: {}, rareLuck: 1,
      down: false, respawnAt: 0, needsStarter: true, uniqueEncounter: null, defeatedTrainers: new Set(),
      augments: [], augmentOffer: null, offerQueue: [], bossLockUntil: 0,
      battle: null, immuneSteps: 0, lastMoveAt: 0, moveBudget: 3, lastChatAt: 0, dirty: true,
    };
    resetProgress(p);
    giveStarter(p, starter);
    this.players.set(p.id, p);
    this.byToken.set(p.token, p);
    this.sockets.set(ws, p);
    this.send(p, { t: 'welcome', id: p.id, token: p.token });
    this.send(p, { t: 'pos', x: p.x, y: p.y, teleport: true });
    this.flushSelf(p);
    this.toastAll(`${p.name} joined the game.`, 'info');
    if (this.bossPhase === 'fight') this.toast(p, 'A boss fight is under way! Step into the portal in town to join it.', 'boss');
  }

  private resume(ws: WebSocket, token: string) {
    const p = this.byToken.get(token);
    if (!p) return this.sendWs(ws, { t: 'resumeFailed' });
    if (p.ws && p.ws !== ws) {
      this.sockets.delete(p.ws);
      try { p.ws.close(); } catch { /* ignore */ }
    }
    p.ws = ws;
    this.sockets.set(ws, p);
    this.send(p, { t: 'welcome', id: p.id, token: p.token });
    this.send(p, { t: 'pos', x: p.x, y: p.y, teleport: true });
    this.flushSelf(p);
    p.battle?.broadcast();
  }

  private removePlayer(p: Player) {
    p.battle?.removeParticipant(p, 'left');
    this.players.delete(p.id);
    this.byToken.delete(p.token);
    this.toastAll(`${p.name} left the game.`, 'info');
    if (this.players.size === 0) this.resetRun(false);
  }

  // ================================================================ messaging

  private sendWs(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  send(p: Player, msg: ServerMsg) {
    if (p.ws) this.sendWs(p.ws, msg);
  }

  private toast(p: Player, text: string, kind: ToastKind = 'info') {
    this.send(p, { t: 'toast', text, kind });
  }

  private toastAll(text: string, kind: ToastKind = 'info') {
    for (const p of this.players.values()) this.toast(p, text, kind);
  }

  private flushSelf(p: Player) {
    p.dirty = false;
    this.send(p, { t: 'self', self: selfState(p) });
  }

  private chat(p: Player, text: string) {
    const now = Date.now();
    text = text.trim().slice(0, 200);
    if (!text || now - p.lastChatAt < 400) return;
    p.lastChatAt = now;
    for (const q of this.players.values()) this.send(q, { t: 'chat', from: p.name, color: p.color, text });
  }

  // ================================================================ tick

  private tick() {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;

    for (const b of this.battles) b.tick(now);
    this.duel?.tick(now);
    if (this.duelAt && now >= this.duelAt) {
      this.duelAt = 0;
      this.startDuel();
    }

    for (const p of [...this.players.values()]) {
      if (!p.ws && now - p.disconnectedAt > cfg.reconnectGraceSeconds * 1000) {
        this.removePlayer(p);
        continue;
      }
      if (p.down && now >= p.respawnAt) this.respawn(p);
    }

    this.tickBoss(now, dt);

    const world = JSON.stringify({ t: 'world', world: this.worldState(now) } satisfies ServerMsg);
    for (const p of this.players.values()) {
      if (p.dirty) this.flushSelf(p);
      if (p.ws && p.ws.readyState === 1) p.ws.send(world);
    }
  }

  private connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.ws) n++;
    return n;
  }

  private worldState(now: number): WorldState {
    return {
      serverNow: now,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, x: p.x, y: p.y, color: p.color, connected: !!p.ws,
        lead: (p.party.find((m) => m.hp > 0) ?? p.party[0])?.species ?? null,
        leadTier: (p.party.find((m) => m.hp > 0) ?? p.party[0])?.tier ?? 1,
        state: p.down ? 'down' : p.battle ? 'battle' : 'free',
      })),
      battles: [...this.battles].map((b) => ({
        id: b.id, x: b.x, y: b.y, kind: b.kind, count: b.participants.size, joinable: b.joinable && (b.kind === 'wild' || b.kind === 'trainer'),
      })).concat(this.duel ? [{ id: this.duel.id, x: this.duel.x, y: this.duel.y, kind: 'duel', count: 2, joinable: false }] : []),
      boss: this.bossClock(),
      connected: this.connectedCount(),
    };
  }

  private bossClock(): BossClock {
    const idx = Math.min(this.bossIndex, data.bosses.length - 1);
    return {
      phase: this.bossPhase,
      secondsLeft: this.bossPhase === 'victory'
        ? Math.max(0, Math.ceil((this.resetAt - Date.now()) / 1000))
        : Math.max(0, Math.ceil(this.bossTimerMs / 1000)),
      bossIndex: idx,
      bossName: bossDisplayName(data.bosses[idx].name, this.bossLoop),
      bossesDefeated: this.bossesDefeated,
      loop: this.bossLoop,
    };
  }

  // ================================================================ movement & encounters

  private spawnPosition(at: { x: number; y: number } = this.spawn): { x: number; y: number } {
    const options: { x: number; y: number }[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = at.x + dx, y = at.y + dy;
      if (worldMap.isWalkable(x, y)) options.push({ x, y });
    }
    return options[Math.floor(Math.random() * options.length)] ?? { x: at.x, y: at.y };
  }

  private teleport(p: Player, x: number, y: number) {
    p.x = x;
    p.y = y;
    p.dirty = true;
    this.send(p, { t: 'pos', x, y, teleport: true });
  }

  private move(p: Player, x: number, y: number) {
    const reject = () => this.send(p, { t: 'pos', x: p.x, y: p.y });
    if (p.needsStarter || p.down || p.battle) return reject();
    if (!Number.isInteger(x) || !Number.isInteger(y)) return reject();
    if (Math.abs(x - p.x) + Math.abs(y - p.y) !== 1 || !worldMap.isWalkable(x, y)) return reject();
    const gate = worldMap.gateQuest(x, y);
    if (gate && p.quests[gate]?.state !== 'done') {
      const now0 = Date.now();
      if (now0 - (this.lastGateToast.get(p) ?? 0) > 3000) {
        this.lastGateToast.set(p, now0);
        const q = this.questDef(gate);
        const giver = q ? data.quests.npcs[q.giver].name : 'The warden';
        this.toast(p, `${giver}: "Nobody passes until they complete ${q?.name ?? 'my task'}."`, 'bad');
      }
      return reject();
    }
    const now = Date.now();
    // token bucket: tolerates network jitter bunching up a few steps, but caps sustained speed
    p.moveBudget = Math.min(3, p.moveBudget + (now - p.lastMoveAt) / (cfg.moveIntervalMs * 0.9));
    p.lastMoveAt = now;
    if (p.moveBudget < 1) return reject();
    p.moveBudget -= 1;
    p.x = x;
    p.y = y;

    if (this.portals.some((o) => o.x === x && o.y === y)) {
      if (this.bossPhase === 'fight' && this.bossBattle) this.enterBossFight(p);
      else this.toast(p, 'The portal is dormant. It opens when a boss appears.', 'info');
      return;
    }

    // Walking into an active wild fight joins it (not right after leaving one, so fleeing sticks).
    for (const b of this.battles) {
      if (p.immuneSteps > 0) break;
      if ((b.kind === 'wild' || b.kind === 'trainer') && b.joinable && cheb(b.x, b.y, x, y) <= cfg.combat.joinRadius) {
        if (b.addParticipant(p)) {
          this.toast(p, 'You joined the fight!', 'info');
          b.broadcast();
          return;
        }
      }
    }

    // Stepping into an undefeated trainer's line of sight starts a battle, Pokémon-style.
    const spotter = this.trainerSpotting(p);
    if (spotter) { this.startTrainerBattle(p, spotter); return; }

    if (p.immuneSteps > 0) { p.immuneSteps--; return; }
    if (!worldMap.canEncounter(x, y)) return;
    const zone = worldMap.zoneAt(x, y)!;
    if (Math.random() < (zone.encounterRate ?? 0.1)) this.startWildEncounter(p, zone);
  }

  /** The id of an undefeated trainer whose line of sight the player is standing in, if any. */
  private trainerSpotting(p: Player): string | null {
    for (const o of worldMap.objectsOfType('trainer')) {
      if (p.defeatedTrainers.has(o.id!)) continue;
      const t = data.trainers[o.id!];
      const [dx, dy] = DIRS[t.facing];
      for (let i = 1; i <= t.sight; i++) {
        const tx = o.x + dx * i, ty = o.y + dy * i;
        if (!worldMap.isWalkable(tx, ty)) break; // walls and objects block the view
        if (tx === p.x && ty === p.y) return o.id!;
      }
    }
    return null;
  }

  /** Badges a player still needs before this trainer accepts their challenge (only the Champion asks). */
  private missingBadges(p: Player, trainerId: string) {
    if (!data.trainers[trainerId]?.elite || !data.gyms.championNeedsAllBadges) return [];
    const held = new Set(badgesOf(data, p.defeatedTrainers).map((g) => g.id));
    return data.gyms.gyms.filter((g) => !held.has(g.id));
  }

  startTrainerBattle(p: Player, id: string): Battle | null {
    const def = data.trainers[id];
    if (!def || p.battle || !p.party.some((m) => m.hp > 0)) return null;
    const zone = worldMap.zoneAt(p.x, p.y) ?? data.zones[data.zones.length - 1];
    const team = Battle.trainerTeam(def, p);
    const battle = new Battle(this, 'trainer', zone, p.x, p.y, [team[0]]);
    battle.trainer = { id, def };
    battle.reserve.push(...team.slice(1));
    battle.addParticipant(p);
    this.toast(p, `❗ ${def.name} wants to battle!`, 'boss');
    const gym = gymOfLeader(data, id);
    if (gym) this.toastAll(`${gym.icon} ${p.name} is challenging ${def.name} at the ${gym.name}! Walk in to help.`, 'info');
    if (def.elite) this.toastAll(`👑 ${p.name} is challenging ${def.name} at the Champion's Throne! Walk into the fight to help!`, 'boss');
    this.battles.add(battle);
    battle.start();
    return battle;
  }

  private rollSpecies(zone: ZoneDef, luck: number): { monster: string; tier: number } {
    const table = zone.encounters!;
    const weights = table.map((e) => e.weight * (e.rare ? luck : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let pickE = table[table.length - 1];
    for (let i = 0; i < table.length; i++) {
      r -= weights[i];
      if (r <= 0) { pickE = table[i]; break; }
    }
    return { monster: pickE.monster, tier: pickE.tier ?? 1 };
  }

  startWildEncounter(p: Player, zone: ZoneDef): Battle | null {
    if (!p.party.some((m) => m.hp > 0)) return null;
    let battle: Battle;
    const ue = p.uniqueEncounter;
    if (ue && ue.zone === zone.id) {
      p.uniqueEncounter = null;
      p.dirty = true;
      const m = createMonster(ue.monster, ue.level, tierForLevel(ue.level, ue.tier ?? 1));
      battle = new Battle(this, 'unique', zone, p.x, p.y, [Battle.wildCombatant(m)], p.id);
      this.toast(p, `The crystals sing... ${data.monsters[ue.monster].name} appears, for you alone!`, 'good');
    } else {
      const [gMin, gMax] = zone.groupSize ?? [1, 1];
      const [lMin, lMax] = zone.levelRange!;
      const count = randInt(gMin, gMax);
      const monsters: Monster[] = [];
      for (let i = 0; i < count; i++) {
        const roll = this.rollSpecies(zone, p.rareLuck);
        const lv = randInt(lMin, lMax);
        const m = createMonster(roll.monster, lv, tierForLevel(lv, roll.tier));
        m.maxHp = Math.round(m.maxHp * (zone.hpMult ?? 1));
        m.hp = m.maxHp;
        monsters.push(m);
      }
      const enemies: Combatant[] = monsters.map((m, i) => {
        const dupes = monsters.filter((o) => o.species === m.species).length > 1;
        return Battle.wildCombatant(m, dupes ? ` ${String.fromCharCode(65 + i)}` : '');
      });
      battle = new Battle(this, 'wild', zone, p.x, p.y, enemies);
    }
    battle.addParticipant(p);
    if (battle.kind === 'wild') {
      // Everyone nearby is pulled in.
      for (const q of this.players.values()) {
        if (q === p || !q.ws || q.battle || q.down || q.needsStarter) continue;
        const qz = worldMap.zoneAt(q.x, q.y);
        if (!qz || qz.kind === 'safe' || qz.kind === 'arena') continue;
        if (cheb(q.x, q.y, p.x, p.y) > cfg.combat.encounterPullRadius) continue;
        if (battle.addParticipant(q)) this.toast(q, `You were pulled into ${p.name}'s fight!`, 'info');
      }
    }
    this.battles.add(battle);
    battle.start();
    return battle;
  }

  // ================================================================ battle host callbacks

  onPlayerLeft(battle: Battle, p: Player, reason: 'fled' | 'wiped' | 'left', lines: string[]) {
    p.dirty = true;
    if (reason === 'left') return;
    if (reason === 'fled') {
      p.immuneSteps = cfg.combat.immuneStepsAfterBattle;
      this.send(p, { t: 'battleEnd', id: battle.id, result: 'fled', summary: lines });
      return;
    }
    p.down = true;
    p.respawnAt = Date.now() + cfg.respawnSeconds * 1000 * (1 - Math.min(0.9, mod(augmentMods(data, p.augments), 'respawn')));
    if (battle.kind === 'boss') p.bossLockUntil = Date.now() + cfg.boss.rejoinLockoutSeconds * 1000;
    this.send(p, { t: 'battleEnd', id: battle.id, result: 'wiped', summary: lines, hits: battle.hits });
  }

  onBattleEnd(battle: Battle, o: BattleOutcome) {
    this.battles.delete(battle);
    if (battle.kind === 'boss') return this.onBossEnd(battle, o);

    const perPlayer = new Map<Player, string[]>();
    const championWinners: string[] = [];
    if (o.result === 'victory' || o.result === 'caught') {
      for (const { player, uids } of o.participants) {
        const lines: string[] = [];
        let xp = 0;
        let coins = 0;
        const trainer = battle.trainer;
        for (const e of o.defeated) {
          xp += formulas.xpYield({ baseXp: data.monsters[e.species].baseXp, enemyLevel: e.monster.level });
          if (battle.zone.coins && !trainer) coins += randInt(battle.zone.coins[0], battle.zone.coins[1]);
          this.questEvent(player, { kind: 'defeat', zone: battle.zone.id, species: e.species, type: e.type });
        }
        if (o.caught && o.caughtBy === player) {
          xp += formulas.xpYield({ baseXp: data.monsters[o.caught.species].baseXp, enemyLevel: o.caught.level });
        }
        if (trainer && o.result === 'victory') {
          xp *= cfg.combat.trainerXpMult;
          coins += trainer.def.rewards.coins;
          const firstWin = !player.defeatedTrainers.has(trainer.id);
          player.defeatedTrainers.add(trainer.id);
          this.questEvent(player, { kind: 'trainers' });
          if (trainer.def.elite) championWinners.push(player.name);
          const gym = gymOfLeader(data, trainer.id);
          if (gym && firstWin) {
            lines.push(`${gym.icon} You earned the ${gym.badge}! Your ${data.types[gym.type].name} moves deal +${Math.round(data.gyms.badgeBonus * 100)}% damage.`);
            this.toast(player, `${gym.icon} ${gym.badge} earned!`, 'good');
            this.toastAll(`${gym.icon} ${player.name} earned the ${gym.badge}!`, 'info');
          }
          lines.push(`${trainer.def.name}: "${trainer.def.defeat}"`);
          for (const [item, n] of Object.entries(trainer.def.rewards.items ?? {})) {
            player.items[item] = (player.items[item] ?? 0) + n;
            lines.push(`Got ${n} × ${data.items[item].name}!`);
          }
        }
        xp = Math.round(xp);
        if (xp > 0) lines.push(...this.awardXp(player, uids, xp));
        coins = Math.round(coins * (1 + mod(augmentMods(data, player.augments), 'coins')));
        if (coins > 0) { player.coins += coins; lines.push(`+${coins} coins`); }
        if (o.result === 'victory' && !trainer) {
          for (const l of battle.zone.loot ?? []) {
            if (Math.random() < l.chance) {
              player.items[l.item] = (player.items[l.item] ?? 0) + 1;
              lines.push(`Found a ${data.items[l.item].name}!`);
            }
          }
        }
        player.dirty = true;
        perPlayer.set(player, lines);
      }
      if (o.caught && o.caughtBy) {
        const m = o.caught;
        // Wild zones may inflate HP; a caught monster gets its normal stats back.
        const ratio = m.hp / m.maxHp;
        Object.assign(m, computeStats(m.species, m.level, m.tier));
        m.hp = Math.max(1, Math.round(m.maxHp * ratio));
        const where = addMonster(o.caughtBy, m);
        const def = data.monsters[m.species];
        this.questEvent(o.caughtBy, { kind: 'catch', zone: battle.zone.id, species: m.species, type: def.type });
        perPlayer.get(o.caughtBy)?.unshift(`${def.name} was added to your ${where}!`);
      }
    }

    for (const { player } of o.participants) {
      player.immuneSteps = cfg.combat.immuneStepsAfterBattle;
      player.dirty = true;
      const headline = o.result === 'victory' ? 'Victory!'
        : o.result === 'caught' ? (o.caughtBy === player ? 'Caught!' : `${o.caughtBy?.name} caught it!`)
        : o.result === 'aborted' ? 'Interrupted' : 'Fight over';
      this.send(player, {
        t: 'battleEnd', id: battle.id, result: headline,
        summary: [...o.summary, ...(perPlayer.get(player) ?? [])],
        hits: battle.hits,
      });
    }
    if (championWinners.length && battle.trainer) this.winRun(battle.trainer.def.name, championWinners);
  }

  /** Beating the elite trainer wins the run for the whole server. */
  private winRun(champion: string, winners: string[]) {
    if (this.bossPhase === 'victory') return;
    this.bossBattle?.abort();
    this.bossBattle = null;
    this.bossPhase = 'victory';
    this.resetAt = Date.now() + cfg.boss.victoryResetSeconds * 1000;
    this.toastAll(`🏆 ${winners.join(' & ')} defeated ${champion}! The run is won!`, 'good');
    for (const p of this.players.values()) this.send(p, { t: 'victory', resetIn: cfg.boss.victoryResetSeconds, winners, champion });
  }

  /** Every participant gets full XP; it goes to each healthy monster that fought. */
  private awardXp(p: Player, uids: string[], baseXp: number): string[] {
    const mods = augmentMods(data, p.augments);
    const xp = Math.round(baseXp * (1 + mod(mods, 'xp')));
    const lines = [`+${xp} XP`];
    let recipients = p.party.filter((m) => uids.includes(m.uid) && m.hp > 0);
    if (!recipients.length) recipients = p.party.filter((m) => m.hp > 0).slice(0, 1);
    // Training Camp & co: benched monsters get a share too
    const benchShare = mod(mods, 'partyXp');
    const bench = benchShare > 0 ? p.party.filter((m) => m.hp > 0 && !recipients.includes(m)) : [];
    for (const m of [...recipients, ...bench]) {
      const before = m.species;
      const amount = recipients.includes(m) ? xp : Math.round(xp * benchShare);
      for (const ev of gainXp(m, amount)) {
        lines.push(ev);
        this.toast(p, ev, 'level');
      }
      if (m.species !== before) {
        this.send(p, { t: 'evolved', kind: 'evolve', from: [before], to: m.species, tier: m.tier, level: m.level });
      }
    }
    this.questEvent(p, { kind: 'level' });
    return lines;
  }

  // ================================================================ bosses

  private tickBoss(now: number, dt: number) {
    if (this.bossPhase === 'victory') {
      if (now >= this.resetAt) this.resetRun(true);
      return;
    }
    if (this.bossPhase !== 'countdown') return;
    if (this.connectedCount() === 0) return; // the clock only runs while someone is playing
    this.bossTimerMs -= dt;
    const s = Math.ceil(this.bossTimerMs / 1000);
    for (const w of [60, cfg.boss.warningSeconds, 10]) {
      if (s <= w && !this.warned.has(w) && w < cfg.boss.intervalSeconds) {
        this.warned.add(w);
        this.toastAll(`⚠ ${data.bosses[this.bossIndex].name} arrives in ${w} seconds! Heal up!`, 'boss');
      }
    }
    if (this.bossTimerMs <= 0) this.startBoss();
  }

  private arenaPositions(): { x: number; y: number }[] {
    const arena = zoneById('arena');
    const out: { x: number; y: number }[] = [];
    const [rx, ry, rw, rh] = arena.rects[0];
    for (let y = this.arenaSpawn.y; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      if (worldMap.isWalkable(x, y)) out.push({ x, y });
    }
    out.sort((a, b) => cheb(a.x, a.y, this.arenaSpawn.x, this.arenaSpawn.y) - cheb(b.x, b.y, this.arenaSpawn.x, this.arenaSpawn.y));
    return out.length ? out : [{ x: this.arenaSpawn.x, y: this.arenaSpawn.y }];
  }

  startBoss() {
    this.duelAt = 0;
    this.duel?.abort();
    for (const b of [...this.battles]) b.abort();
    const def = data.bosses[this.bossIndex];
    // Snapshot connected players so joins/disconnects never shift the boss mid-fight.
    const N = Math.max(1, this.connectedCount());
    const { combatant, state } = Battle.bossCombatant(def, N, this.bossLoop);
    const battle = new Battle(this, 'boss', zoneById('arena'), this.bossSpot.x, this.bossSpot.y, [combatant]);
    battle.boss = state;
    this.bossBattle = battle;
    this.bossPhase = 'fight';
    const spots = this.arenaPositions();
    let i = 0;
    for (const p of this.players.values()) {
      // Disconnected players can join through the portal once they're back.
      if (!p.ws || p.down || p.needsStarter || !p.party.some((m) => m.hp > 0)) continue;
      const pos = spots[i++ % spots.length];
      this.teleport(p, pos.x, pos.y);
      battle.addParticipant(p);
    }
    this.toastAll(`☠ ${bossDisplayName(def.name, this.bossLoop)}, ${def.title}, has appeared! Everyone is pulled into the arena!`, 'boss');
    this.battles.add(battle);
    battle.start();
  }

  private enterBossFight(p: Player) {
    const b = this.bossBattle!;
    const wait = Math.ceil((p.bossLockUntil - Date.now()) / 1000);
    if (wait > 0) {
      this.toast(p, `The portal rejects you: you fell in this fight. You can rejoin in ${wait}s.`, 'bad');
      return;
    }
    if (!p.party.some((m) => m.hp > 0)) {
      this.toast(p, 'Your monsters are too weak to fight. Heal first!', 'bad');
      return;
    }
    const spots = this.arenaPositions();
    const pos = spots[Math.floor(Math.random() * spots.length)];
    this.teleport(p, pos.x, pos.y);
    if (b.addParticipant(p)) {
      this.toast(p, `You leap through the portal into the fight against ${b.boss!.def.name}!`, 'boss');
      b.broadcast();
    }
  }

  private onBossEnd(battle: Battle, o: BattleOutcome) {
    this.bossBattle = null;
    const def = battle.boss!.def;
    const won = o.result === 'victory';
    const current = new Map(o.participants.map((x) => [x.player, x.uids]));
    for (const p of battle.everParticipated) {
      if (!this.players.has(p.id)) continue;
      const lines: string[] = [];
      if (won) {
        const uids = current.get(p) ?? [];
        lines.push(...this.awardXp(p, uids, def.rewards.xp));
        const bossCoins = Math.round(def.rewards.coins * (1 + mod(augmentMods(data, p.augments), 'coins')));
        p.coins += bossCoins;
        lines.push(`+${bossCoins} coins`);
        for (const [item, n] of Object.entries(def.rewards.items)) {
          p.items[item] = (p.items[item] ?? 0) + n;
          lines.push(`+${n} ${data.items[item].name}`);
        }
      }
      p.dirty = true;
      p.immuneSteps = cfg.combat.immuneStepsAfterBattle;
      if (current.has(p)) {
        this.send(p, {
          t: 'battleEnd', id: battle.id, result: won ? `${def.name} defeated!` : 'The boss won...',
          summary: [...o.summary, ...lines],
          hits: battle.hits,
        });
      } else if (won) {
        this.toast(p, `${def.name} was defeated while you were down. You still share the rewards!`, 'good');
      }
    }
    // Power pick for everyone, whether the boss won or lost (later bosses roll rarer powers).
    this.bossFights++;
    for (const p of this.players.values()) if (!p.needsStarter) this.offerAugments(p, this.bossFights - 1);
    // Everyone still standing in the arena goes home.
    for (const p of this.players.values()) {
      if (p.down) continue;
      if (worldMap.zoneAt(p.x, p.y)?.id === 'arena') {
        const pos = this.spawnPosition();
        this.teleport(p, pos.x, pos.y);
      }
    }
    this.warned.clear();
    if (won) {
      // Bosses never end the run: they cycle, and come back empowered after the last one.
      this.bossesDefeated++;
      this.bossIndex++;
      if (this.bossIndex >= data.bosses.length) {
        this.bossIndex = 0;
        this.bossLoop++;
        this.toastAll(`${def.name} is defeated! The bosses will return EMPOWERED. Only the Champion can end this.`, 'boss');
      } else {
        this.toastAll(`${def.name} is defeated! The next boss stirs... (the run is won by beating the Champion)`, 'good');
      }
    } else {
      this.toastAll(`${def.name} prevailed. It will return in ${clock(cfg.boss.intervalSeconds)}. Get stronger!`, 'bad');
    }
    this.bossPhase = 'countdown';
    this.bossTimerMs = cfg.boss.intervalSeconds * 1000;
    this.afterBossFight();
  }

  /** Every boss fight ends with all teams fully healed (fallen players are back on their feet), then a duel. */
  private afterBossFight() {
    for (const p of this.players.values()) {
      if (p.down) this.respawn(p);
      for (const m of allMonsters(p)) healFull(m);
      p.bossLockUntil = 0;
      p.dirty = true;
    }
    this.toastAll('💚 The boss fight is over: every team is fully healed!', 'good');
    if ([...this.players.values()].filter((p) => p.ws && !p.needsStarter).length >= 2) {
      this.duelAt = Date.now() + cfg.duel.delaySeconds * 1000;
      this.toastAll(`⚔ In ${cfg.duel.delaySeconds}s two random trainers will be pulled into a DUEL!`, 'boss');
    }
  }

  private startDuel() {
    if (this.bossPhase !== 'countdown' || this.duel) return;
    const pool = [...this.players.values()].filter((p) => p.ws && !p.needsStarter && !p.down && !p.battle && p.party.some((m) => m.hp > 0));
    if (pool.length < 2) return;
    const shuffled = pool.map((p) => [Math.random(), p] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const [a, b] = shuffled;
    for (const p of [a, b]) for (const m of allMonsters(p)) healFull(m);
    this.teleport(a, this.arenaSpawn.x - 2, this.arenaSpawn.y);
    this.teleport(b, this.arenaSpawn.x + 2, this.arenaSpawn.y);
    this.duel = new Duel(this, a, b, this.bossSpot.x, this.bossSpot.y);
    this.toastAll(`⚔ DUEL: ${a.name} vs ${b.name} in the arena!`, 'boss');
    this.duel.start();
  }

  onDuelEnd(duel: Duel, winner: Player | null, loser: Player | null, log: string[]) {
    if (this.duel === duel) this.duel = null;
    for (const s of duel.sides) {
      const p = s.player;
      if (!this.players.has(p.id)) continue;
      const won = p === winner;
      const coins = winner ? (won ? cfg.duel.winnerCoins : cfg.duel.loserCoins) : 0;
      p.coins += coins;
      for (const m of allMonsters(p)) healFull(m);
      p.immuneSteps = cfg.combat.immuneStepsAfterBattle;
      p.dirty = true;
      if (worldMap.zoneAt(p.x, p.y)?.id === 'arena') {
        const pos = this.spawnPosition();
        this.teleport(p, pos.x, pos.y);
      }
      this.send(p, {
        t: 'battleEnd', id: duel.id,
        result: !winner ? 'Duel over' : won ? '🏆 You won the duel!' : 'You lost the duel',
        summary: [...log, ...(coins ? [`+${coins} coins`] : []), 'Your team has been fully healed.'],
      });
    }
    if (winner && loser) this.toastAll(`🏆 ${winner.name} won the duel against ${loser.name}!`, 'good');
  }

  /** Starts a fresh run. */
  resetRun(announce: boolean) {
    this.duelAt = 0;
    this.duel?.abort();
    for (const b of [...this.battles]) b.abort();
    this.bossBattle = null;
    this.bossIndex = 0;
    this.bossesDefeated = 0;
    this.bossLoop = 0;
    this.bossFights = 0;
    this.bossPhase = 'countdown';
    this.bossTimerMs = cfg.boss.intervalSeconds * 1000;
    this.warned.clear();
    for (const p of this.players.values()) {
      resetProgress(p);
      const pos = this.spawnPosition();
      this.teleport(p, pos.x, pos.y);
    }
    if (announce) this.toastAll('A new run begins! Choose your starter.', 'good');
  }

  // ================================================================ death

  private respawn(p: Player) {
    p.down = false;
    for (const m of allMonsters(p)) healFull(m);
    const frontier = this.outpostSpawn && worldMap.zoneAt(p.x, p.y) && !this.inStartingRegion(p.x, p.y);
    const pos = this.spawnPosition(frontier ? this.outpostSpawn! : this.spawn);
    this.teleport(p, pos.x, pos.y);
    p.immuneSteps = cfg.combat.immuneStepsAfterBattle;
    this.toast(p, `You respawned ${frontier ? 'at the Frontier Outpost' : 'in town'} with a fully healed team.`, 'good');
    if (this.bossPhase === 'fight') this.toast(p, 'The boss fight is still on! Step into the portal to rejoin.', 'boss');
  }

  /** The starting region: everything west of / above the frontier gate's line. */
  private inStartingRegion(x: number, y: number) {
    const gate = worldMap.objectsOfType('gate')[0];
    return !gate || (x <= gate.x && y < 40);
  }

  // ================================================================ town services

  private near(p: Player, type: string, id?: string) {
    return worldMap.objectsNear(p.x, p.y).some((o) => o.type === type && (id === undefined || o.id === id));
  }

  private heal(p: Player) {
    if (p.battle || !this.near(p, 'heal')) return;
    for (const m of allMonsters(p)) healFull(m);
    p.dirty = true;
    this.toast(p, 'Your monsters are fully healed!', 'good');
  }

  private buy(p: Player, itemId: string, qty: number) {
    const item = data.items[itemId];
    if (!item || item.price <= 0 || !this.near(p, 'shop')) return;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return;
    const cost = discounted(item.price, mod(augmentMods(data, p.augments), 'shopDiscount')) * qty;
    if (p.coins < cost) return this.toast(p, 'Not enough coins.', 'bad');
    p.coins -= cost;
    p.items[itemId] = (p.items[itemId] ?? 0) + qty;
    p.dirty = true;
    this.toast(p, `Bought ${qty} × ${item.name}.`, 'good');
  }

  private useItemOutside(p: Player, itemId: string, uid: string) {
    if (p.battle) return;
    const item = data.items[itemId];
    const m = allMonsters(p).find((m) => m.uid === uid);
    if (!item || !m || (p.items[itemId] ?? 0) <= 0) return;
    if (item.kind === 'heal') {
      if (m.hp <= 0) return this.toast(p, `${monsterName(m)} has fainted: use a Revive.`, 'bad');
      if (m.hp >= m.maxHp) return this.toast(p, `${monsterName(m)} is already at full HP.`, 'info');
      m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * (item.healPct ?? 0.5)));
    } else if (item.kind === 'revive') {
      if (m.hp > 0) return this.toast(p, `${monsterName(m)} hasn't fainted.`, 'info');
      m.hp = Math.max(1, Math.floor(m.maxHp * (item.healPct ?? 0.5)));
    } else {
      return;
    }
    p.items[itemId]--;
    if (p.items[itemId] <= 0) delete p.items[itemId];
    p.dirty = true;
    this.toast(p, `Used ${item.name} on ${monsterName(m)}.`, 'good');
  }

  /** Fusion Lab: two monsters (party or storage) + coins -> one fusion-only monster. */
  private fuse(p: Player, uidA: string, uidB: string) {
    if (p.battle || !this.near(p, 'fusion')) return;
    if (uidA === uidB) return this.toast(p, 'Pick two different monsters.', 'bad');
    const all = allMonsters(p);
    const a = all.find((m) => m.uid === uidA), b = all.find((m) => m.uid === uidB);
    if (!a || !b) return;
    const plan = planFusion(data, a, b);
    if (typeof plan === 'string') return this.toast(p, `The fuser refuses: ${plan}.`, 'bad');
    const { species: result, tier, level } = plan;
    const cost = plan.cost > 0 ? discounted(plan.cost, mod(augmentMods(data, p.augments), 'fusionDiscount')) : 0;
    if (p.coins < cost) return this.toast(p, `Fusing costs ${cost} coins. You have ${p.coins}.`, 'bad');

    p.coins -= cost;
    const slot = p.party.indexOf(a) >= 0 ? p.party.indexOf(a) : p.party.indexOf(b);
    p.party = p.party.filter((m) => m !== a && m !== b);
    p.storage = p.storage.filter((m) => m !== a && m !== b);
    const fused = createMonster(result, level, tier);
    if (slot >= 0) p.party.splice(Math.min(slot, p.party.length), 0, fused);
    else addMonster(p, fused);
    p.dirty = true;
    this.toast(p, `⚗ ${monsterName(a)} + ${monsterName(b)} fused into ${'★'.repeat(tier)} ${monsterName(fused)} (Lv ${level})! -${cost} coins`, 'level');
    this.send(p, { t: 'evolved', kind: 'fusion', from: [a.species, b.species], to: fused.species, tier, level });
    this.questEvent(p, { kind: 'fuse' });
  }

  private partyOp(p: Player, op: 'lead' | 'store' | 'withdraw', uid: string) {
    if (p.battle) return this.toast(p, "You can't rearrange your party during a fight.", 'bad');
    if (op === 'lead') {
      const i = p.party.findIndex((m) => m.uid === uid);
      if (i > 0) p.party.unshift(...p.party.splice(i, 1));
    } else if (op === 'store') {
      const i = p.party.findIndex((m) => m.uid === uid);
      if (i < 0) return;
      if (p.party.length <= 1) return this.toast(p, 'You need at least one monster in your party.', 'bad');
      p.storage.push(...p.party.splice(i, 1));
    } else {
      const i = p.storage.findIndex((m) => m.uid === uid);
      if (i < 0) return;
      if (p.party.length >= cfg.party.maxSize) return this.toast(p, 'Your party is full.', 'bad');
      p.party.push(...p.storage.splice(i, 1));
    }
    p.dirty = true;
  }

  // ================================================================ powers (augments)

  private offerAugments(p: Player, bossIdx: number) {
    p.offerQueue.push(bossIdx);
    if (!p.augmentOffer) this.nextOffer(p);
    p.dirty = true;
  }

  private nextOffer(p: Player) {
    const idx = p.offerQueue.shift();
    if (idx === undefined) { p.augmentOffer = null; return; }
    const A = data.augments;
    const weights = A.rarityWeights[Math.min(idx, A.rarityWeights.length - 1)];
    let r = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
    let rarity = Object.keys(weights)[0];
    for (const [k, w] of Object.entries(weights)) { r -= w; if (r <= 0) { rarity = k; break; } }
    p.augmentOffer = { options: this.rollAugments(p, rarity, []), rerolls: A.rerollsPerOffer, rarity };
    p.dirty = true;
    this.toast(p, '🎁 Choose a new power!', 'boss');
  }

  /** Random powers of a rarity that the player doesn't own, avoiding `avoid` when possible. */
  private rollAugments(p: Player, rarity: string, avoid: string[]): string[] {
    const A = data.augments;
    const shuffle = <T>(arr: T[]) => arr.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const fresh = A.augments.filter((a) => !p.augments.includes(a.id));
    let pool = shuffle(fresh.filter((a) => a.rarity === rarity && !avoid.includes(a.id)));
    if (pool.length < A.optionsPerOffer) pool = [...pool, ...shuffle(fresh.filter((a) => a.rarity === rarity && avoid.includes(a.id)))];
    if (pool.length < A.optionsPerOffer) pool = [...pool, ...shuffle(fresh.filter((a) => a.rarity !== rarity))];
    return pool.slice(0, A.optionsPerOffer).map((a) => a.id);
  }

  private rerollAugments(p: Player) {
    const o = p.augmentOffer;
    if (!o || o.rerolls <= 0) return;
    o.options = this.rollAugments(p, o.rarity, o.options);
    o.rerolls--;
    p.dirty = true;
  }

  private pickAugment(p: Player, id: string) {
    const o = p.augmentOffer;
    if (!o || !o.options.includes(id)) return;
    const a = data.augments.augments.find((x) => x.id === id)!;
    p.augments.push(id);
    const g = a.grant;
    if (g?.coins) p.coins += g.coins;
    if (g?.rareLuck) p.rareLuck += g.rareLuck;
    for (const [item, n] of Object.entries(g?.items ?? {})) p.items[item] = (p.items[item] ?? 0) + n;
    this.toast(p, `${a.icon} ${a.name}: ${a.description}`, 'good');
    this.nextOffer(p);
    p.dirty = true;
  }

  // ================================================================ quests

  private questDef(id: string): QuestDef | undefined {
    return data.quests.quests.find((q) => q.id === id);
  }

  private acceptQuest(p: Player, id: string) {
    const q = this.questDef(id);
    if (!q || p.quests[id] || !this.near(p, 'npc', q.giver)) return;
    if (!q.requires.every((r) => p.quests[r]?.state === 'done')) return this.toast(p, 'You are not ready for that quest yet.', 'bad');
    p.quests[id] = { state: 'active', progress: q.objectives.map(() => 0) };
    p.dirty = true;
    this.toast(p, `Quest accepted: ${q.name}`, 'info');
    this.questEvent(p, { kind: 'level' });
  }

  private turnInQuest(p: Player, id: string) {
    const q = this.questDef(id);
    const st = p.quests[id];
    if (!q || !st || st.state !== 'active' || !this.near(p, 'npc', q.giver)) return;
    if (!q.objectives.every((o, i) => st.progress[i] >= o.count)) return this.toast(p, 'That quest is not complete yet.', 'bad');
    st.state = 'done';
    const r = q.rewards;
    const got: string[] = [];
    if (r.coins) { p.coins += r.coins; got.push(`${r.coins} coins`); }
    for (const [item, n] of Object.entries(r.items ?? {})) {
      p.items[item] = (p.items[item] ?? 0) + n;
      got.push(`${n} × ${data.items[item].name}`);
    }
    if (r.rareLuck) { p.rareLuck += r.rareLuck; got.push(`rare luck +${r.rareLuck}`); }
    if (r.monster) {
      const where = addMonster(p, createMonster(r.monster.species, r.monster.level));
      got.push(`${data.monsters[r.monster.species].name} (to your ${where})`);
    }
    if (r.uniqueEncounter) {
      p.uniqueEncounter = { ...r.uniqueEncounter };
      got.push(`a one-time encounter in the ${zoneById(r.uniqueEncounter.zone).name}`);
    }
    p.dirty = true;
    this.toast(p, `Quest complete: ${q.name}! Reward: ${got.join(', ') || 'gratitude'}`, 'good');
  }

  private questEvent(p: Player, ev: QuestEvent) {
    const maxLevel = Math.max(0, ...allMonsters(p).map((m) => m.level));
    const maxTierOwned = Math.max(0, ...allMonsters(p).map((m) => m.tier));
    for (const [id, st] of Object.entries(p.quests)) {
      if (st.state !== 'active') continue;
      const q = this.questDef(id);
      if (!q) continue;
      const wasComplete = q.objectives.every((o, i) => st.progress[i] >= o.count);
      q.objectives.forEach((o, i) => {
        if (st.progress[i] >= o.count) return;
        if (o.kind === 'level') {
          if (maxLevel >= (o.level ?? 1)) st.progress[i] = o.count;
          return;
        }
        if (o.kind === 'tier') {
          if (maxTierOwned >= (o.tier ?? 1)) st.progress[i] = o.count;
          return;
        }
        if (o.kind !== ev.kind) return;
        if (ev.kind === 'trainers' || ev.kind === 'fuse') { st.progress[i]++; return; }
        if (o.zone && o.zone !== ev.zone) return;
        if (o.species && o.species !== ev.species) return;
        if (o.type && o.type !== ev.type) return;
        st.progress[i]++;
      });
      p.dirty = true;
      if (!wasComplete && q.objectives.every((o, i) => st.progress[i] >= o.count)) {
        this.toast(p, `Quest ready: ${q.name}. Return to ${data.quests.npcs[q.giver].name}!`, 'good');
      }
    }
  }
}
