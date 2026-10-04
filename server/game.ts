import crypto from 'crypto';
import type WebSocket from 'ws';
import type {
  BossClock, ClientMsg, QuestDef, ServerMsg, ToastKind, WorldState, ZoneDef,
} from '../shared/types';
import { fusionBlocker, fusionCost, fusionLevel, fusionResult } from '../shared/fusion';
import { Battle, BattleHost, BattleOutcome, Combatant } from './battle';
import { cfg, data, formulas, worldMap, zoneById } from './data';
import { computeStats, createMonster, gainXp, healFull, Monster, monsterName } from './monster';
import { addMonster, allMonsters, giveStarter, Player, resetProgress, selfState } from './player';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#e84393', '#00cec9', '#fd79a8', '#6c5ce7', '#fab1a0'];
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

type QuestEvent =
  | { kind: 'defeat'; zone: string; species: string; type: string }
  | { kind: 'catch'; zone: string; species: string; type: string }
  | { kind: 'level' };

export class Game implements BattleHost {
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
  private bossBattle: Battle | null = null;
  private resetAt = 0;
  private warned = new Set<number>();

  private readonly spawn = worldMap.firstObject('spawn');
  private readonly arenaSpawn = worldMap.firstObject('arenaSpawn');
  private readonly bossSpot = worldMap.firstObject('bossSpot');
  private readonly portal = worldMap.firstObject('portal');

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
      case 'challenge': {
        const id = String(msg.id);
        if (!this.near(p, 'trainer', id) || p.battle || p.down) return;
        if (p.defeatedTrainers.has(id)) return this.toast(p, `${data.trainers[id].name}: "${data.trainers[id].defeat}"`, 'info');
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
        state: p.down ? 'down' : p.battle ? 'battle' : 'free',
      })),
      battles: [...this.battles].map((b) => ({
        id: b.id, x: b.x, y: b.y, kind: b.kind, count: b.participants.size, joinable: b.joinable && (b.kind === 'wild' || b.kind === 'trainer'),
      })),
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
      bossName: data.bosses[idx].name,
      bossesDefeated: this.bossesDefeated,
      bossesToWin: cfg.boss.bossesToWin,
    };
  }

  // ================================================================ movement & encounters

  private spawnPosition(): { x: number; y: number } {
    const options: { x: number; y: number }[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = this.spawn.x + dx, y = this.spawn.y + dy;
      if (worldMap.isWalkable(x, y)) options.push({ x, y });
    }
    return options[Math.floor(Math.random() * options.length)] ?? { x: this.spawn.x, y: this.spawn.y };
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
    const now = Date.now();
    // token bucket: tolerates network jitter bunching up a few steps, but caps sustained speed
    p.moveBudget = Math.min(3, p.moveBudget + (now - p.lastMoveAt) / (cfg.moveIntervalMs * 0.9));
    p.lastMoveAt = now;
    if (p.moveBudget < 1) return reject();
    p.moveBudget -= 1;
    p.x = x;
    p.y = y;

    if (x === this.portal.x && y === this.portal.y) {
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

  startTrainerBattle(p: Player, id: string): Battle | null {
    const def = data.trainers[id];
    if (!def || p.battle || !p.party.some((m) => m.hp > 0)) return null;
    const zone = worldMap.zoneAt(p.x, p.y) ?? data.zones[data.zones.length - 1];
    const team = def.team.map((t) => Battle.trainerCombatant(createMonster(t.monster, t.level), def.name));
    const battle = new Battle(this, 'trainer', zone, p.x, p.y, [team[0]]);
    battle.trainer = { id, def };
    battle.reserve.push(...team.slice(1));
    battle.addParticipant(p);
    this.toast(p, `❗ ${def.name} wants to battle!`, 'boss');
    this.battles.add(battle);
    battle.start();
    return battle;
  }

  private rollSpecies(zone: ZoneDef, luck: number): string {
    const table = zone.encounters!;
    const weights = table.map((e) => e.weight * (e.rare ? luck : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < table.length; i++) {
      r -= weights[i];
      if (r <= 0) return table[i].monster;
    }
    return table[table.length - 1].monster;
  }

  startWildEncounter(p: Player, zone: ZoneDef): Battle | null {
    if (!p.party.some((m) => m.hp > 0)) return null;
    let battle: Battle;
    const ue = p.uniqueEncounter;
    if (ue && ue.zone === zone.id) {
      p.uniqueEncounter = null;
      p.dirty = true;
      const m = createMonster(ue.monster, ue.level);
      battle = new Battle(this, 'unique', zone, p.x, p.y, [Battle.wildCombatant(m)], p.id);
      this.toast(p, `The crystals sing... ${data.monsters[ue.monster].name} appears, for you alone!`, 'good');
    } else {
      const [gMin, gMax] = zone.groupSize ?? [1, 1];
      const [lMin, lMax] = zone.levelRange!;
      const count = randInt(gMin, gMax);
      const monsters: Monster[] = [];
      for (let i = 0; i < count; i++) {
        const m = createMonster(this.rollSpecies(zone, p.rareLuck), randInt(lMin, lMax));
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
    p.respawnAt = Date.now() + cfg.respawnSeconds * 1000;
    this.send(p, { t: 'battleEnd', id: battle.id, result: 'wiped', summary: lines, hits: battle.hits });
  }

  onBattleEnd(battle: Battle, o: BattleOutcome) {
    this.battles.delete(battle);
    if (battle.kind === 'boss') return this.onBossEnd(battle, o);

    const perPlayer = new Map<Player, string[]>();
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
          player.defeatedTrainers.add(trainer.id);
          lines.push(`${trainer.def.name}: "${trainer.def.defeat}"`);
          for (const [item, n] of Object.entries(trainer.def.rewards.items ?? {})) {
            player.items[item] = (player.items[item] ?? 0) + n;
            lines.push(`Got ${n} × ${data.items[item].name}!`);
          }
        }
        xp = Math.round(xp);
        if (xp > 0) lines.push(...this.awardXp(player, uids, xp));
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
        Object.assign(m, computeStats(m.species, m.level));
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
  }

  /** Every participant gets full XP; it goes to each healthy monster that fought. */
  private awardXp(p: Player, uids: string[], xp: number): string[] {
    const lines = [`+${xp} XP`];
    let recipients = p.party.filter((m) => uids.includes(m.uid) && m.hp > 0);
    if (!recipients.length) recipients = p.party.filter((m) => m.hp > 0).slice(0, 1);
    for (const m of recipients) {
      for (const ev of gainXp(m, xp)) {
        lines.push(ev);
        this.toast(p, ev, 'level');
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
    for (const b of [...this.battles]) b.abort();
    const def = data.bosses[this.bossIndex];
    // Snapshot connected players so joins/disconnects never shift the boss mid-fight.
    const N = Math.max(1, this.connectedCount());
    const { combatant, state } = Battle.bossCombatant(def, N);
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
    this.toastAll(`☠ ${def.name}, ${def.title}, has appeared! Everyone is pulled into the arena!`, 'boss');
    this.battles.add(battle);
    battle.start();
  }

  private enterBossFight(p: Player) {
    const b = this.bossBattle!;
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
        p.coins += def.rewards.coins;
        lines.push(`+${def.rewards.coins} coins`);
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
      this.bossesDefeated++;
      this.bossIndex = Math.min(this.bossIndex + 1, data.bosses.length - 1);
      if (this.bossesDefeated >= cfg.boss.bossesToWin) {
        this.bossPhase = 'victory';
        this.resetAt = Date.now() + cfg.boss.victoryResetSeconds * 1000;
        this.toastAll(`🏆 All ${cfg.boss.bossesToWin} bosses defeated! You survived!`, 'good');
        for (const p of this.players.values()) this.send(p, { t: 'victory', resetIn: cfg.boss.victoryResetSeconds });
        return;
      }
      this.toastAll(`${def.name} is defeated! ${cfg.boss.bossesToWin - this.bossesDefeated} to go. The next boss stirs...`, 'good');
    } else {
      this.toastAll(`${def.name} prevailed. It will return in ${clock(cfg.boss.intervalSeconds)}. Get stronger!`, 'bad');
    }
    this.bossPhase = 'countdown';
    this.bossTimerMs = cfg.boss.intervalSeconds * 1000;
  }

  /** Starts a fresh run. */
  resetRun(announce: boolean) {
    for (const b of [...this.battles]) b.abort();
    this.bossBattle = null;
    this.bossIndex = 0;
    this.bossesDefeated = 0;
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
    const pos = this.spawnPosition();
    this.teleport(p, pos.x, pos.y);
    p.immuneSteps = cfg.combat.immuneStepsAfterBattle;
    this.toast(p, 'You respawned in town with a fully healed team.', 'good');
    if (this.bossPhase === 'fight') this.toast(p, 'The boss fight is still on! Step into the portal to rejoin.', 'boss');
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
    const cost = item.price * qty;
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
    for (const m of [a, b]) {
      const why = fusionBlocker(data, m.species, m.level);
      if (why) return this.toast(p, `${monsterName(m)} can't be fused: ${why}.`, 'bad');
    }
    const result = fusionResult(data, a.species, b.species);
    if (!result) return this.toast(p, 'The fuser sputters: no recipe for that pair.', 'bad');
    const level = fusionLevel(data, a.level, b.level);
    const cost = fusionCost(data, level);
    if (p.coins < cost) return this.toast(p, `Fusing costs ${cost} coins. You have ${p.coins}.`, 'bad');

    p.coins -= cost;
    const slot = p.party.indexOf(a) >= 0 ? p.party.indexOf(a) : p.party.indexOf(b);
    p.party = p.party.filter((m) => m !== a && m !== b);
    p.storage = p.storage.filter((m) => m !== a && m !== b);
    const fused = createMonster(result, level);
    if (slot >= 0) p.party.splice(Math.min(slot, p.party.length), 0, fused);
    else addMonster(p, fused);
    p.dirty = true;
    this.toast(p, `⚗ ${monsterName(a)} + ${monsterName(b)} fused into ${monsterName(fused)} (Lv ${level})! -${cost} coins`, 'level');
    this.questEvent(p, { kind: 'level' });
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
        if (ev.kind === 'level' || o.kind !== ev.kind) return;
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
