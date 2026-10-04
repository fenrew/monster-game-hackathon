# Survive the Bosses

A browser co-op monster-catching game. Explore a small shared map, catch and level monsters, and do quests.
Every 5 minutes a boss pulls the whole server into the arena. Defeat 3 bosses to win. Every run starts fresh.

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
  Town (safe) → Meadow (solo, Lv 1-5) → Forest (solo, Lv 5-10) → Marsh (2 players, Lv 10-15) → Crystal Cave
  (3-4 players, Lv 15-20, a hotspot where every tile can trigger an encounter).
- **Combat** uses timed simultaneous rounds. Everyone picks an action within 8s. A round resolves when all connected
  players have chosen or time runs out. Idle players repeat their last ability (or their strongest one).
  Resolution order is flee → items and swaps → abilities and orb throws by speed.
- **Co-op**: players within 3 tiles of an encounter are pulled in. Anyone can walk into a fight marked ⚔ on the map.
  Every participant gets full XP. The first successful catch, in speed order, belongs to the thrower and ends the fight.
- **Bosses**: a global countdown runs, then everyone is teleported to the arena. Boss HP and targets per round scale with
  the connected player count, snapshotted at spawn. Bosses telegraph big attacks a round ahead, so use Guard (yourself)
  or Bulwark (the whole team). A lost boss fight returns everyone to town and the same boss comes back next cycle.
- **Trainers** stand around the map. Walk into their line of sight (the arrow shows which way they look) or press E
  next to them to battle. They send out their team one monster at a time. You can't flee or catch, but they pay
  coins and items and give 1.5× XP. Each player can beat each trainer once per run. Others can walk into the fight to help.
- **Fusion Lab** (in town): pick two of your monsters (Lv 5+, from party or storage) and pay coins to fuse them into
  one of 6 fusion-only species. The parents' type pair decides the result (e.g. Spark + Tide → Stormfin). The result's
  level is the higher parent's level. Both parents are used up. The cost is `100 + 20 × level`.
- **Soundtrack**: three original rock tracks synthesized live in the browser (no audio files): Route Riot while
  exploring, Wild Clash in battles, Titan in boss fights. Songs and instruments live in `client/src/music.ts`.
- **Damage numbers** pop over every monster that takes damage, heals or dodges each round.
- **Wipes**: if all your monsters faint you respawn in town after 15s with a healed team. You lose nothing.
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
| `abilities.json` | Power, accuracy, priority, targeting, guard/bulwark/heal/buff effects |
| `items.json` | Potions, revives, orbs (`catchMult`), shop prices (`price: 0` = not sold) |
| `zones.json` | Rectangles, level range, recommended party size, encounter table with `rare` flags, group size, `hpMult`, hotspot flag, loot, colours |
| `quests.json` | NPCs and quests (objectives: `defeat` / `catch` / `level`; rewards: coins, items, rareLuck, monster, uniqueEncounter) |
| `trainers.json` | Trainer name, facing, sight range, intro/defeat lines, team (monster + level), rewards. Place them in `map.json` as `{"type":"trainer","id":...}` |
| `fusions.json` | Fusion recipes (type pair → result), min parent level, cost and level formulas. Fusion-only monsters have `"fusion": true` in `monsters.json`; `"noFusion": true` protects a monster from being fused |
| `bosses.json` | Boss stats, moves (`targets`: scaled/all/self, `telegraph`), move rotation, HP-threshold phases |
| `map.json` | The 40×40 tile grid (one string per row) plus objects (NPCs, signs, heal, shop, portal, spawns) |
| `types.json` | The type triangle: Spark → Tide → Stone → Spark |

Formulas in `config.json` are one-line JavaScript expressions:

```json
"hpFormula": "baseHp * (1 + 0.6 * (N - 1))",
"targetsFormula": "1 + Math.floor(N / 3)",
"xpToNextFormula": "12 + 6 * level",
"xpYieldFormula": "Math.round(baseXp * enemyLevel / 4)",
"catchFormula": "catchRate * orbMult * (1 - (2 / 3) * (hp / maxHp))"
```

`map.json` was generated by `npm run genmap` (from the zone rectangles) and is meant to be hand-edited from here on.
Re-running the generator overwrites your edits.

### Balance check

`npm test` runs the rule tests plus a boss simulation with a simple, competent AI, so you can see the effect of a change:

```
Gravemaw           (party Lv 10)  1p:   7%  2p:  87%  4p: 100%  8p: 100%
Stormcaller Vyrn   (party Lv 15)  1p:  48%  2p:  73%  4p: 100%  8p: 100%
Leviathrax         (party Lv 19)  1p:  12%  2p:  42%  4p:  92%  8p: 100%
```

Note that with the default HP formula bigger groups have it easier: each extra player adds 0.6× boss HP but brings
a full 1× of damage, and the boss's damage is spread over more people. If big servers steamroll the bosses, steepen the
formula, for example `baseHp * N` or `1 + Math.floor(N / 2)` targets. Override the simulated party levels with
`BOSS_LEVELS=12,16,20 npm test`.

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
