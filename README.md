# Survive the Bosses

A browser co-op monster-catching game. Explore a small shared map, catch and level monsters, and do quests.
Every 5 minutes a boss pulls the whole server into the arena. To win, earn the three gym badges, then beat Champion
Aurelia on her throne at the far end of the map. Every run starts fresh.

## Quick start

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

For development, `npm run dev` rebuilds on change and restarts the server, including when you edit a file in `data/`.

Requires Node 16 or newer.

## Play with friends

The Node server serves the client and the WebSocket on one port, so a single tunnel is enough:

```bash
cloudflared tunnel --url http://localhost:3000
```

Share the `https://….trycloudflare.com` URL it prints. A quick tunnel gets a new URL each run. ngrok or router
port forwarding also work. Set `PORT=xxxx` to use a different port.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| E / Space | Talk, shop, heal, read signs |
| P / B / Q / H | Party, bag, quests, help |
| Enter | Chat |
| 1-9 | Pick an ability in battle |
| M | Toggle music (volume slider in the bottom-right) |
| Esc | Close menus |

## How it plays

- **Zones** are colour-coded by difficulty: the ground colour, the minimap tint, signposts at entrances (level range and
  party-size icon) and a banner when you enter all show the same tier.
  The world is 80×60 tiles. The **starting region** (top-left) holds Town (safe) → Meadow (solo, Lv 1-5) → Forest
  (solo, Lv 5-10) → Marsh (2 players, Lv 10-15) → Crystal Cave (3-4 players, Lv 15-20, a hotspot where every tile can
  trigger an encounter).
- **The frontier gate**: the starting region is fenced in. Warden Holt at the east gate only lets a player through once
  they finish his *Frontier Pass* quest (own a ★2 monster and beat 2 trainers). The gate is per player. Beyond it are the
  Frontier Outpost (heal, shop, Fusion Lab, boss portal), the Windy Steppe (Lv 12-18), Thunder Peaks (Lv 17-23), the
  Sunken Ruins (hotspot, Lv 20-26) and the Obsidian Wastes (Lv 24-30), with ★2 and rare ★3 wild monsters and four more trainers.
- **Combat** uses timed simultaneous rounds. Everyone picks an action within 8s. A round resolves when all connected
  players have chosen or time runs out. Idle players repeat their last ability (or their strongest one).
  Resolution order is flee → items and swaps → abilities and orb throws by speed.
- **Co-op**: players within 3 tiles of an encounter are pulled in. Anyone can walk into a fight marked ⚔ on the map.
  Every participant gets full XP. The first successful catch, in speed order, belongs to the thrower and ends the fight.
- **Bosses**: a global countdown runs, then everyone is teleported to the arena. Boss HP and targets per round scale with
  the connected player count, snapshotted at spawn. Bosses telegraph big attacks a round ahead, so use Guard (yourself)
  or Bulwark (the whole team). A lost boss fight returns everyone to town and the same boss comes back next cycle.
  Bosses no longer end the run: they keep coming every 5 minutes, and after the third they cycle back to the first,
  **Empowered** (+50% HP and +15% attack per cycle; `empowerHpPerLoop` / `empowerAtkPerLoop` in `config.json`).
- **After every boss fight** (won or lost), every team is fully healed and anyone knocked out is back on their feet.
  A few seconds later two random online trainers are pulled into a **1v1 duel** in the arena: each controls their own
  team in normal timed rounds (no fleeing, catching or revives; the 3-potion limit applies). The winner gets 200 coins,
  the loser 50, and both are healed again afterwards. Tune it under `duel` in `config.json`.
- **Boss rejoin lockout**: if you are wiped during a boss fight, the portal stays closed to you for 60s after you fell
  (`boss.rejoinLockoutSeconds`). The respawn screen and top bar show the countdown.
- **The win condition: Champion Aurelia**, the elite trainer at the Champion's Throne in the far south-east corner past
  the Obsidian Wastes. Press E next to her to challenge her; everyone online is told, and friends can walk into the
  fight to help. Her team is six ★5 legendaries, the final forms of every ★4 fusion line: Atlantaeus, Typhonova, Omnicolos, Orogrand, Oceanarch and a Zenivolt ace (Lv 42-46). She fields **one legendary per challenger at once** (up to 4, `combat.eliteMaxActive`) and sends in the next as each falls. Her team also **scales with you**: it shifts up so her weakest monster is at least your strongest monster's level − 3 (`matchLevel` in `trainers.json`, capped at Lv 50), so out-levelling her doesn't trivialise the fight. Unlike other trainers she fights smart: the most damaging move on the most vulnerable target, healing when low. Tuned so 3 players with 4 legendaries each win roughly a third of the time. Beating her wins the run for the
  whole server. Mark any trainer in `trainers.json` with `"elite": true` to make them the final challenge (exactly one).
- **Gyms**: three walled gyms, each with gym trainers guarding the way to a Leader at the back:
  🪨 **Stonehold Gym** (Leader Brannoc, Stone) in Sunny Meadow just west of town, ⚡ **Voltage Gym** (Leader Zara,
  Spark) in the east of the Windy Steppe, and 🌊 **Riptide Gym** (Leader Marina, Tide) in the Sunken Ruins. Leaders
  are challenged with E (friends can walk in to help), use the same smart AI as the Champion, and everyone who wins the
  fight earns the badge. Each badge gives +10% damage to moves of the gym's type for the rest of the run (`badgeBonus`),
  and the Champion only accepts challengers holding all badges (`championNeedsAllBadges`); friends without badges can
  still walk into a Champion fight that has started. Badges show under your coins. Configure gyms in `gyms.json`; each gym
  is a `safe` zone in `zones.json` and its leader is a normal trainer in `trainers.json`.
- **Trainers** stand around the map. Walk into their line of sight (the arrow shows which way they look) or press E
  next to them to battle. They send out their team one monster at a time. You can't flee or catch, but they pay
  coins and items and give 1.2× XP. Each player can beat each trainer once per run. Others can walk into the fight to help.
- **Tiers and fusion** are the core progression. Every monster has a tier from ★ to ★★★★★: higher tiers multiply its
  stats (×1 / 1.35 / 1.8 / 2.4 / 3.2) and teach stronger moves, ending in a ★5 signature move. Each tier also has a
  **level cap**: Lv 10 / 20 / 30 / 40 / 50. Wild and trainer monsters above a cap automatically come as a higher tier
  (a Lv 15 marsh monster is ★2).
  At a Fusion Lab (town and outpost), fuse two monsters of the **same tier** into one of the next tier. Both need
  Lv 7 (★1→★2), Lv 10 (★2→★3), Lv 13 (★3→★4) or Lv 16 (★4→★5). Into ★2, two of the same species stay that species
  and mixed species follow the type-pair recipes (e.g. Spark + Tide → Stormfin). **Into ★3 and ★4 you always get a
  brand-new species** for the parents' type pair, with much higher base stats and a signature move: six ★3s (Fulgurion,
  Magnetaur, Titanox, Bogulith, Abyssion, Tempestray) and six ★4s (Voltaron, Colossar, Orogon, Atlantor, Thalassor,
  Typhonix). Into ★5 the species stays. **Fusion species evolve too**: ★2 species at Lv 15, ★3 at Lv 22 and ★4 at Lv 30, into 18 evolved forms (e.g. Titanox → Behemox, Voltaron → Zenivolt) with ~15% higher stats, new colours, energy wings/halos/rune circles and a stronger move. The Fusion Lab has no recipe book, so experiment to discover them. The fused monster starts at **Lv 1**. Both parents
  are used up. The cost is `50 × tier² − 100` coins (★2: 100, ★3: 350, ★4: 700, ★5: 1150). Fusions and evolutions
  each get a celebratory popup.
- **Tier visuals** escalate with every tier: ★2 soft aura and rising motes; ★3 rim light and a spinning rune
  pedestal; ★4 turning light rays, orbiting energy orbs and a holographic shine sweep; ★5 a prismatic ring, pulsing
  double rim light and twinkling stars. Evolved forms get feathered, flapping wings. Big portraits animate (SVG/SMIL,
  kept in phase across re-renders); small icons and map followers use a still version. ★3+ battle cards glow in the
  tier colour, and ★5 cards pulse.
- **Powers** (like augments in Teamfight Tactics): after every boss fight, won or lost, each player picks one of 3
  random powers from a pool of 25 (Silver, Gold and Prismatic; deliberately modest), e.g. +6% damage, +catch chance, cheaper fusions, lifesteal,
  type specialists, or a co-op banner that buffs every ally in your fights. Later bosses roll rarer powers. Each pick
  has one free reroll, can be postponed ("Decide later" keeps a 🎁 button in the HUD), and stacks for the rest of the run.
- **Combat log** keeps the whole fight, grouped by round. It scrolls, follows new rounds, and keeps your place if
  you scroll up to read. The end-of-fight summary shows the full fight too.
- **Potion limit**: each player can use at most 3 healing items (Potions, Super Potions) per fight
  (`combat.potionsPerFight` in `config.json`). The Bag tab shows how many are left. Revives don't count.
- **Healing fatigue**: every healing ability that lands on a monster cuts all further healing on it by 40% for the
  rest of that fight (`combat.healDecay` in `config.json`), so fights can't be stalled forever. Battle cards show the
  remaining healing as 🩹 60%. Bosses' self-heals are affected too.
- **Soundtrack**: three original rock tracks synthesized live in the browser (no audio files): Route Riot while
  exploring, Wild Clash in battles, Titan in boss fights. Songs and instruments live in `client/src/music.ts`.
- **Damage numbers** pop over every monster that takes damage, heals or dodges each round.
- **Wipes**: if all your monsters faint you respawn after 15s with a healed team: in town, or at the Frontier Outpost if you fell out there. You lose nothing.
  If a boss fight is still running, the town portal takes you back in.
- **Quests** give coins, items, *rare luck* (multiplies the weight of rare encounter entries) and, at the end of Sage
  Orla's chain, a one-time private encounter with the unique monster Aurorix.

## Rebalancing: everything lives in `data/`

The server reads these files at startup and validates the cross-references. Broken data fails fast with a list of
errors. The client receives the data from the server, so you never need to rebuild the client to rebalance.

| File | Contents |
| --- | --- |
| `config.json` | Round length, radii, respawn time, boss interval, start kit, and the formulas below |
| `monsters.json` | Stats, type, catch rate, `learnset` (ability at level), `evolvesTo` / `evolveLevel`, portrait shape and colour |
| `abilities.json` | 43 abilities: power, accuracy, priority, targeting, guard/bulwark/heal/buff/debuff effects, plus `drain` (heal the user by a share of the damage dealt) and `recoil` (the user takes a share of the damage dealt) |
| `items.json` | Potions, revives, orbs (`catchMult`), shop prices (`price: 0` = not sold) |
| `zones.json` | Rectangles, level range, recommended party size, encounter table with `rare` flags, group size, `hpMult`, hotspot flag, loot, colours |
| `quests.json` | NPCs and quests (objectives: `defeat` / `catch` / `level`; rewards: coins, items, rareLuck, monster, uniqueEncounter) |
| `trainers.json` | Trainer name, facing, sight range, intro/defeat lines, team (monster + level), rewards. Place them in `map.json` as `{"type":"trainer","id":...}` |
| `gyms.json` | Gyms: name, type, leader (a trainer id), badge name/icon/colour, zone; `badgeBonus` and `championNeedsAllBadges` |
| `augments.json` | Powers offered after boss fights: rarities and their odds per boss, options per offer, rerolls, and each power's `mods` (dmg, dmgTaken, spd, crit, catch, xp, coins, heal, lifesteal, bossDmg, teamDmg, typeDmg_<type>, shopDiscount, fusionDiscount, respawn, openingGuard, partyXp) or instant `grant` |
| `tiers.json` | Tier names and colours, stat multipliers, the level needed to fuse each tier, and the moves each tier grants per type |
| `fusions.json` | Fusion recipes (type pair → result) into ★2, `tierRecipes` for the new ★3 and ★4 species, cost and level formulas. Fusion-only monsters have `"fusion": true` in `monsters.json`; `"noFusion": true` protects a monster from being fused |
| `bosses.json` | Boss stats, moves (`targets`: scaled/all/self, `telegraph`), move rotation, HP-threshold phases |
| `map.json` | The 80×60 tile grid (one string per row) plus objects (NPCs, signs, heal, shops, portals, spawns, trainers, and `gate` tiles that need a quest) |
| `types.json` | The type triangle: Spark → Tide → Stone → Spark |

Formulas in `config.json` are one-line JavaScript expressions:

```json
"hpFormula": "baseHp * (1 + 0.6 * (N - 1))",
"targetsFormula": "1 + Math.floor(N / 3)",
"xpToNextFormula": "12 + 6 * level",
"xpYieldFormula": "Math.round(baseXp * enemyLevel / 6)",
"catchFormula": "catchRate * orbMult * (1 - (2 / 3) * (hp / maxHp))"
```

`map.json` was generated by `npm run genmap` (from the zone rectangles) and is meant to be hand-edited from here on.
Re-running the generator overwrites your edits.

### Balance check

`npm test` runs the rule tests plus a boss simulation with a simple, competent AI, so you can see the effect of a change:

```
Gravemaw           (party ★1 Lv 9)  1p:   7%  2p:  38%  4p:  62%  8p:  98%
Stormcaller Vyrn   (party ★2 Lv 11)  1p:  30%  2p:  52%  4p:  92%  8p: 100%
Leviathrax         (party ★2 Lv 16)  1p:   5%  2p:  30%  4p:  92%  8p: 100%
Gym balance
Leader Brannoc     (party ★2 Lv 12)  1p:  56%  2p: 100%  4p: 100%
Leader Zara        (party ★2 Lv 20)  1p:   6%  2p:  52%  4p: 100%
Leader Marina      (party ★3 Lv 24)  1p:   0%  2p:  82%  4p: 100%
Champion Aurelia   (3× ★5 Lv 45 each)  2p:   0%  3p:   0%  4p:   6%
Champion Aurelia   (4× ★5 Lv 45 each)  2p:  11%  3p:  35%  4p:  71%
Champion Aurelia   (3× ★5 Lv 50 each)  2p:   1%  3p:   1%  4p:   5%
Champion Aurelia   (4× ★5 Lv 50 each)  2p:   3%  3p:  32%  4p:  76%
```

Note that with the default HP formula bigger groups have it easier: each extra player adds 0.6× boss HP but brings
a full 1× of damage, and the boss's damage is spread over more people. If big servers steamroll the bosses, steepen the
formula, for example `baseHp * N` or `1 + Math.floor(N / 2)` targets. Override the simulated party levels with
`BOSS_LEVELS=10,13,16 BOSS_TIERS=1,2,3 npm test`.

## Project layout

```
shared/   types + protocol, map helpers (used by client and server)
server/   index.ts (HTTP + WebSocket), game.ts (world, movement, encounters, bosses, quests, shop),
          battle.ts (round resolution), monster.ts (stats, XP, evolution), data.ts (loading + validation), test.ts
client/   index.html, style.css, src/ (Phaser world scene, DOM HUD, battle UI, menus, procedural SVG portraits)
data/     all game content (see above)
scripts/  genmap.mjs
```

The server is authoritative. Clients only send intents (move one tile, "I choose X", buy, accept quest). The server
owns HP, timers, encounters and resolution, and checks positions for town services.

The networking is plain `ws` with session tokens (a page reload resumes your session for 2 minutes), not Colyseus. It's
minimal and works on Node 16.
