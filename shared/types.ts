// Data definitions (mirroring the JSON files in /data) and the network protocol.

export type TypeId = string;
export type StatKey = 'atk' | 'def' | 'spd';
export type Stages = Partial<Record<StatKey, number>>;

export interface TypeDef { name: string; color: string; strongAgainst: TypeId | null }

export interface AbilityDef {
  name: string;
  type: TypeId;
  power: number;
  accuracy: number;
  target: 'enemy' | 'allEnemies' | 'self' | 'team';
  priority?: number;
  guard?: number;   // damage multiplier for the user this round
  bulwark?: number; // damage multiplier for the user's whole team this round
  healPct?: number;
  buff?: Stages;
  debuff?: Stages;
  description?: string;
}

export interface MonsterDef {
  name: string;
  type: TypeId;
  shape: string;
  color: string;
  base: { hp: number; atk: number; def: number; spd: number };
  catchRate: number;
  baseXp: number;
  learnset: { level: number; ability: string }[];
  evolvesTo?: string;
  evolveLevel?: number;
  fusion?: boolean;   // only obtainable from the Fusion Lab
  noFusion?: boolean; // can't be used as a fusion parent
  description?: string;
}

export interface ItemDef {
  name: string;
  kind: 'heal' | 'revive' | 'orb';
  healPct?: number;
  catchMult?: number;
  price: number;
  description: string;
}

export interface ZoneDef {
  id: string;
  name: string;
  kind: 'safe' | 'grass' | 'hotspot' | 'arena';
  hotspot?: boolean;
  rects: [number, number, number, number][];
  levelRange?: [number, number];
  recommended?: string; // "solo" | "2" | "3-4" | "everyone"
  groupSize?: [number, number];
  hpMult?: number;
  encounterRate?: number;
  coins?: [number, number];
  encounters?: { monster: string; weight: number; rare?: boolean }[];
  loot?: { item: string; chance: number }[];
  groundColor: string;
  grassColor: string;
  tierColor: string;
}

export interface MapObject { type: string; x: number; y: number; id?: string; zone?: string }
export interface MapDef {
  width: number;
  height: number;
  tileSize: number;
  legend: Record<string, { name: string; walkable: boolean; grass?: boolean }>;
  rows: string[];
  objects: MapObject[];
}

export interface QuestObjective {
  kind: 'defeat' | 'catch' | 'level';
  count: number;
  label: string;
  zone?: string;
  species?: string;
  type?: TypeId;
  level?: number;
}
export interface QuestRewards {
  coins?: number;
  items?: Record<string, number>;
  rareLuck?: number;
  monster?: { species: string; level: number };
  uniqueEncounter?: { monster: string; level: number; zone: string };
}
export interface QuestDef {
  id: string;
  giver: string;
  name: string;
  description: string;
  requires: string[];
  objectives: QuestObjective[];
  rewards: QuestRewards;
}
export interface NpcDef { name: string; color: string; greeting: string }
export interface QuestsFile { npcs: Record<string, NpcDef>; quests: QuestDef[] }

export interface BossMoveDef {
  name: string;
  type: TypeId;
  power: number;
  accuracy: number;
  targets: 'scaled' | 'all' | 'self';
  extraTargets?: number;
  telegraph?: string;
  healPct?: number;
  debuff?: Stages;
}
export interface BossPhaseDef {
  belowHpPct: number;
  message: string;
  rotation?: string[];
  atkMult?: number;
  extraTargets?: number;
}
export interface BossDef {
  id: string;
  name: string;
  title: string;
  type: TypeId;
  shape: string;
  color: string;
  level: number;
  baseHp: number;
  stats: { atk: number; def: number; spd: number };
  rewards: { xp: number; coins: number; items: Record<string, number> };
  moves: Record<string, BossMoveDef>;
  rotation: string[];
  phases: BossPhaseDef[];
}

export interface TrainerDef {
  name: string;
  color: string;
  facing: 'up' | 'down' | 'left' | 'right';
  sight: number; // tiles they can see in the facing direction
  intro: string;
  defeat: string;
  team: { monster: string; level: number }[];
  rewards: { coins: number; items: Record<string, number> };
}

export interface FusionsFile {
  minLevel: number;
  costFormula: string;  // variables: level (of the result)
  levelFormula: string; // variables: a, b (parent levels)
  recipes: { types: [string, string]; result: string }[];
}

export interface ConfigFile {
  port: number;
  tickMs: number;
  moveIntervalMs: number;
  respawnSeconds: number;
  reconnectGraceSeconds: number;
  combat: {
    roundSeconds: number;
    encounterPullRadius: number;
    joinRadius: number;
    fleeChance: number;
    immuneStepsAfterBattle: number;
    stab: number;
    superEffective: number;
    notEffective: number;
    critChance: number;
    critMult: number;
    maxKnownAbilities: number;
    trainerXpMult: number;
  };
  boss: {
    intervalSeconds: number;
    warningSeconds: number;
    hpFormula: string;
    targetsFormula: string;
    timeLimitSeconds: number;
    bossesToWin: number;
    victoryResetSeconds: number;
  };
  progression: { xpToNextFormula: string; xpYieldFormula: string; catchFormula: string; maxLevel: number };
  party: { maxSize: number };
  start: { coins: number; items: Record<string, number>; starterLevel: number; starters: string[] };
}

/** Everything the client needs to render the game; sent once on connect. */
export interface GameData {
  config: ConfigFile;
  types: Record<TypeId, TypeDef>;
  abilities: Record<string, AbilityDef>;
  monsters: Record<string, MonsterDef>;
  items: Record<string, ItemDef>;
  zones: ZoneDef[];
  map: MapDef;
  quests: QuestsFile;
  bosses: BossDef[];
  trainers: Record<string, TrainerDef>;
  fusions: FusionsFile;
}

// ---------------------------------------------------------------- protocol

export interface MonsterView {
  uid: string;
  species: string;
  name: string;
  type: TypeId;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  abilities: string[];
}

export interface QuestProgress { state: 'active' | 'done'; progress: number[] }

export interface SelfState {
  id: string;
  name: string;
  x: number;
  y: number;
  coins: number;
  items: Record<string, number>;
  party: MonsterView[];
  storage: MonsterView[];
  quests: Record<string, QuestProgress>;
  rareLuck: number;
  down: boolean;
  respawnAt: number; // server ms timestamp, see serverNow in world
  needsStarter: boolean;
  uniqueEncounter: { monster: string; level: number; zone: string } | null;
  inBattle: string | null;
  defeatedTrainers: string[];
}

export interface WorldPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  state: 'free' | 'battle' | 'down';
  connected: boolean;
}
export interface WorldBattle { id: string; x: number; y: number; kind: BattleKind; count: number; joinable: boolean }
export interface BossClock {
  phase: 'countdown' | 'fight' | 'victory';
  secondsLeft: number;
  bossIndex: number;
  bossName: string;
  bossesDefeated: number;
  bossesToWin: number;
}
export interface WorldState {
  serverNow: number;
  players: WorldPlayer[];
  battles: WorldBattle[];
  boss: BossClock;
  connected: number;
}

export type BattleKind = 'wild' | 'boss' | 'unique' | 'trainer';

/** One HP change in a round, for floating damage numbers. target = enemy id or player id. */
export interface Hit {
  target: string;
  amount: number;
  kind: 'dmg' | 'heal' | 'miss' | 'ability' | 'info'; // ability = callout over the user, info = e.g. catch result
  text?: string;
  crit?: boolean;
  eff?: number; // type effectiveness multiplier
}

export interface EnemyView {
  id: string;
  name: string;
  species: string; // monster id, or boss id when isBoss
  isBoss: boolean;
  type: TypeId;
  level: number;
  hp: number;
  maxHp: number;
  fainted: boolean;
}
export interface ParticipantView {
  playerId: string;
  name: string;
  color: string;
  monsterName: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  chosen: boolean;
  connected: boolean;
}
export interface BattleView {
  id: string;
  kind: BattleKind;
  zoneName: string;
  round: number;
  remainingMs: number;
  roundMs: number;
  enemies: EnemyView[];
  participants: ParticipantView[];
  intent: string | null;
  intentDanger: boolean;
  log: string[];
  hits: Hit[]; // HP changes from the round that just resolved
  trainer: { name: string; color: string; remaining: number; total: number } | null;
  you: {
    activeUid: string;
    chosen: boolean;
    choiceLabel: string | null;
    defaultLabel: string;
  };
}

export type BattleAction =
  | { kind: 'ability'; abilityId: string; targetId?: string }
  | { kind: 'item'; itemId: string; targetId?: string }
  | { kind: 'swap'; uid: string }
  | { kind: 'flee' };

export type ClientMsg =
  | { t: 'join'; name: string; starter: string }
  | { t: 'resume'; token: string }
  | { t: 'pickStarter'; starter: string }
  | { t: 'move'; x: number; y: number }
  | { t: 'action'; action: BattleAction }
  | { t: 'heal' }
  | { t: 'buy'; item: string; qty: number }
  | { t: 'questAccept'; id: string }
  | { t: 'questTurnIn'; id: string }
  | { t: 'useItem'; item: string; uid: string }
  | { t: 'partyLead'; uid: string }
  | { t: 'partyStore'; uid: string }
  | { t: 'partyWithdraw'; uid: string }
  | { t: 'chat'; text: string }
  | { t: 'challenge'; id: string }
  | { t: 'fuse'; a: string; b: string };

export type ToastKind = 'info' | 'good' | 'bad' | 'boss' | 'level';

export type ServerMsg =
  | { t: 'hello'; data: GameData }
  | { t: 'welcome'; id: string; token: string }
  | { t: 'resumeFailed' }
  | { t: 'error'; text: string }
  | { t: 'world'; world: WorldState }
  | { t: 'self'; self: SelfState }
  | { t: 'battle'; battle: BattleView }
  | { t: 'battleEnd'; id: string; result: string; summary: string[]; hits?: Hit[] }
  | { t: 'pos'; x: number; y: number; teleport?: boolean }
  | { t: 'toast'; text: string; kind: ToastKind }
  | { t: 'chat'; from: string; color: string; text: string }
  | { t: 'victory'; resetIn: number };
