import type { MapObject, ToastKind, ZoneDef } from '../../shared/types';
import { recommendedLabel, zoneLevelLabel } from '../../shared/map';
import { badgesOf, gymOfLeader } from '../../shared/augments';
import { $, bar, clear, fmtTime, h, isTyping, releaseFocus } from './dom';
import { closeModal, interact, openBag, openHelp, openParty, openQuests } from './menus';
import { music } from './music';
import { net } from './net';
import { portraitFor, store, tierBadge } from './state';

const MINI = 3; // minimap pixels per tile
let miniBase: HTMLCanvasElement;

export function initHud() {
  buildButtons();
  buildMinimap();
  initChat();
  store.on('world', renderTopbar);
  store.on('self', () => { renderParty(); renderTracker(); renderDown(); });
  store.on('zone', (z: ZoneDef) => { showBanner(z); renderZoneInfo(z); });
  store.on('near', renderHint);
  store.on('toast', toast);
  store.on('chat', addChat);
  store.on('victory', showVictory);
  setInterval(() => { renderDown(); renderVictory(); }, 250);
  setInterval(drawMinimap, 200);

  // Clicked buttons keep focus, and Space would click them again: drop focus after each click.
  document.addEventListener('click', (e) => { if (e.target instanceof HTMLElement && e.target.closest('button')) (document.activeElement as HTMLElement | null)?.blur(); });
  // clicking the map always hands the keyboard back to the game
  $('game').addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur());
  store.on('battleEnd', () => releaseFocus());
  window.addEventListener('keydown', (e) => {
    const typing = isTyping();
    if (e.key === 'Escape') {
      if (typing) (document.activeElement as HTMLInputElement).blur();
      closeModal();
      return;
    }
    if (typing) return;
    if (e.key === 'Enter') {
      if (store.modalOpen || store.battle) return;
      e.preventDefault();
      ($('chatinput') as HTMLInputElement).focus();
      return;
    }
    if (store.battle || !store.self || store.self.needsStarter) return;
    const k = e.key.toLowerCase();
    if (k === 'e' || k === ' ') { e.preventDefault(); if (!store.modalOpen) interact(); }
    else if (k === 'p') openParty();
    else if (k === 'b') openBag();
    else if (k === 'q') openQuests();
    else if (k === 'h' || k === '?') openHelp();
    else if (/^[1-6]$/.test(k) && !store.modalOpen) setLead(Number(k) - 1);
  });
}

// ------------------------------------------------------------ top bar

function renderTopbar() {
  const w = store.world;
  if (!w) return;
  const el = $('topbar');
  const b = w.boss;
  const champion = Object.values(store.data.trainers).find((t) => t.elite);
  const beaten = h('span', { class: 'online', title: 'Bosses defeated this run' }, `☠ ${b.bossesDefeated} defeated`);
  const gyms = store.data.gyms;
  const held = store.self ? badgesOf(store.data, store.self.defeatedTrainers).length : 0;
  const needBadges = gyms.championNeedsAllBadges && held < gyms.gyms.length;
  const goal = champion ? h('span', { class: 'goal', title: needBadges ? `Earn all ${gyms.gyms.length} gym badges, then beat the Champion at the Champion's Throne (far south-east) to win the run` : "Beat the Champion at the Champion's Throne (far south-east) to win the run" },
    needBadges ? `🏅 Goal: ${held}/${gyms.gyms.length} badges, then ${champion.name}` : `👑 Goal: beat ${champion.name}`) : null;
  let main: HTMLElement;
  if (b.phase === 'countdown') {
    const warn = b.secondsLeft <= store.data.config.boss.warningSeconds;
    main = h('span', { class: warn ? 'clock warn' : 'clock' }, '☠ ', h('b', null, b.bossName), ' arrives in ', h('b', { class: 'time' }, fmtTime(b.secondsLeft)));
  } else if (b.phase === 'fight') {
    const lock = Math.ceil(((store.self?.bossLockUntil ?? 0) - store.serverNow()) / 1000);
    main = h('span', { class: 'clock fight' }, '⚔ BOSS FIGHT: ', h('b', null, b.bossName),
      store.self?.inBattle ? '' : lock > 0 ? ` (you can rejoin in ${lock}s)` : ' (portal open in town)');
  } else {
    main = h('span', { class: 'clock win' }, '🏆 Victory! New run in ', h('b', null, fmtTime(b.secondsLeft)));
  }
  clear(el);
  el.append(main, beaten, goal ?? '', h('span', { class: 'online' }, `👥 ${w.connected} online`));
}

// ------------------------------------------------------------ party + quest tracker

function renderParty() {
  const s = store.self;
  const el = $('party');
  clear(el);
  if (!s) return;
  el.append(h('div', { class: 'coins' }, `🪙 ${s.coins}`, h('span', { class: 'muted' }, `  ·  rare luck ×${s.rareLuck.toFixed(1)}`)));
  el.append(renderBadges());
  const powers = renderPowers();
  if (powers) el.append(powers);
  s.party.forEach((m, i) => {
    const lead = i === 0;
    el.append(h('div', {
      class: `pcard${m.hp <= 0 ? ' fainted' : ''}${lead ? ' lead' : ''}`,
      onclick: () => (lead || s.inBattle ? openParty() : setLead(i)),
      title: lead ? 'Your lead: fights first. Click to open your party (P)' : `Click (or press ${i + 1}) to make ${m.name} your lead`,
    },
      h('div', { class: 'pic', html: portraitFor(m.species, 34, m.tier) }),
      h('div', { class: 'pinfo' },
        h('div', { class: 'pname' }, lead ? h('span', { class: 'leadtag' }, 'LEAD ') : h('span', { class: 'slotkey' }, `${i + 1} `), m.name, h('span', { class: 'lv' }, ` Lv ${m.level} `), tierBadge(m.tier)),
        bar(m.hp, m.maxHp),
        m.level >= m.maxLevel ? h('div', { class: 'bar xp max', title: `Level cap for ★${m.tier}: fuse to go further` }, h('div', { class: 'fill', style: 'width:100%' })) : bar(m.xp, m.xpToNext, 'xp'))));
  });
}

/** Pick which monster starts the next fight (outside combat). */
function setLead(index: number) {
  const s = store.self;
  const m = s?.party[index];
  if (!s || !m || index === 0) return;
  if (s.inBattle) { toast("You can't change your lead mid-fight. Use Swap instead.", 'bad'); return; }
  if (m.hp <= 0) toast(`${m.name} has fainted: your first healthy monster will fight instead.`, 'bad');
  net.send({ t: 'partyLead', uid: m.uid });
}

/** One slot per gym: lit once you hold its badge. */
function renderBadges() {
  const held = new Set(badgesOf(store.data, store.self?.defeatedTrainers ?? []).map((g) => g.id));
  return h('div', { class: 'badges' }, ...store.data.gyms.gyms.map((g) => {
    const has = held.has(g.id);
    const leader = store.data.trainers[g.leader];
    return h('span', {
      class: has ? 'badge has' : 'badge',
      style: has ? `border-color:${g.color};box-shadow:0 0 6px ${g.color}` : '',
      title: has ? `${g.badge}: your ${store.data.types[g.type].name} moves deal +${Math.round(store.data.gyms.badgeBonus * 100)}% damage`
        : `${g.badge}: beat ${leader.name} at the ${g.name}`,
    }, g.icon);
  }));
}

function renderPowers() {
  const s = store.self;
  if (!s || !s.augments.length) return null;
  return h('div', { class: 'powers' }, ...s.augments.map((id) => {
    const a = store.data.augments.augments.find((x) => x.id === id);
    const r = a ? store.data.augments.rarities[a.rarity] : undefined;
    return a ? h('span', { class: 'power', style: `border-color:${r?.color ?? '#888'}`, title: `${a.name}: ${a.description}` }, a.icon) : null;
  }));
}

function renderTracker() {
  const s = store.self;
  const el = $('tracker');
  clear(el);
  if (!s) return;
  const active = store.data.quests.quests.filter((q) => s.quests[q.id]?.state === 'active');
  if (s.uniqueEncounter) {
    const z = store.data.zones.find((z) => z.id === s.uniqueEncounter!.zone);
    el.append(h('div', { class: 'tq unique' }, `✦ A unique monster awaits you in the ${z?.name}`));
  }
  for (const q of active) {
    const st = s.quests[q.id];
    const done = q.objectives.every((o, i) => st.progress[i] >= o.count);
    el.append(h('div', { class: `tq${done ? ' done' : ''}` },
      h('b', null, q.name),
      done ? h('div', null, `✔ Return to ${store.data.quests.npcs[q.giver].name}`)
        : h('div', null, q.objectives.map((o, i) => `${o.label} ${st.progress[i]}/${o.count}`).join(' · '))));
  }
}

// ------------------------------------------------------------ minimap

function tierShade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

function buildMinimap() {
  const { map } = store;
  const c = $('minimap') as HTMLCanvasElement;
  c.width = map.width * MINI;
  c.height = map.height * MINI;
  miniBase = document.createElement('canvas');
  miniBase.width = c.width;
  miniBase.height = c.height;
  const ctx = miniBase.getContext('2d')!;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const z = map.zoneAt(x, y);
      const t = map.tile(x, y);
      const tier = z?.tierColor ?? '#666666';
      ctx.fillStyle = t === '~' ? '#1d4f86'
        : !map.isWalkable(x, y) ? tierShade(tier, 0.35)
        : map.isGrass(x, y) ? tierShade(tier, 0.95)
        : tierShade(tier, 0.7);
      ctx.fillRect(x * MINI, y * MINI, MINI, MINI);
    }
  }
}

function drawMinimap() {
  const c = $('minimap') as HTMLCanvasElement;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(miniBase, 0, 0);
  const w = store.world;
  if (!w) return;
  const blink = Math.floor(Date.now() / 400) % 2 === 0;
  for (const b of w.battles) {
    if (b.kind === 'boss' || !blink) continue;
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(b.x * MINI - 3, b.y * MINI - 3, MINI + 6, MINI + 6);
  }
  if (w.boss.phase === 'fight') {
    const p = store.map.firstObject('portal');
    ctx.fillStyle = blink ? '#e0b0ff' : '#9b59b6';
    ctx.fillRect(p.x * MINI - 2, p.y * MINI - 2, MINI + 4, MINI + 4);
  }
  for (const p of w.players) {
    if (p.id === store.myId) continue;
    ctx.fillStyle = p.state === 'down' ? '#777' : p.color;
    ctx.fillRect(p.x * MINI - 1, p.y * MINI - 1, MINI + 2, MINI + 2);
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(store.pos.x * MINI - 2, store.pos.y * MINI - 2, MINI + 4, MINI + 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(store.pos.x * MINI - 1, store.pos.y * MINI - 1, MINI + 2, MINI + 2);
}

function renderZoneInfo(z: ZoneDef) {
  const el = $('zoneinfo');
  clear(el);
  el.style.borderLeftColor = z.tierColor;
  el.append(h('b', null, z.name), h('div', { class: 'muted' },
    z.kind === 'safe' ? 'Safe zone' : [zoneLevelLabel(z), recommendedLabel(z.recommended), z.hotspot ? 'hotspot' : ''].filter(Boolean).join(' · ')));
}

// ------------------------------------------------------------ banner, hint, toasts

let bannerTimer = 0;
function showBanner(z: ZoneDef) {
  const el = $('banner');
  clear(el);
  const detail = z.kind === 'safe' ? 'Safe zone'
    : z.kind === 'arena' ? 'Boss Arena'
    : [zoneLevelLabel(z), recommendedLabel(z.recommended), z.hotspot ? 'encounters everywhere!' : ''].filter(Boolean).join('  ·  ');
  el.append(h('div', { class: 'bname' }, z.name), h('div', { class: 'bdetail' }, detail));
  el.style.setProperty('--tier', z.tierColor);
  el.classList.remove('show');
  void el.offsetWidth; // restart animation
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
}

function eliteHint(id: string): string {
  const name = store.data.trainers[id].name;
  const gyms = store.data.gyms;
  const held = badgesOf(store.data, store.self?.defeatedTrainers ?? []).length;
  if (gyms.championNeedsAllBadges && held < gyms.gyms.length) return `talk to ${name} (only battles holders of all ${gyms.gyms.length} gym badges: you have ${held})`;
  return `challenge ${name}: the FINAL battle (friends can walk in to help)`;
}

function renderHint(objs: MapObject[]) {
  const el = $('hint');
  const o = objs.find((o) => ['npc', 'trainer', 'shop', 'fusion', 'heal', 'sign'].includes(o.type));
  if (!o) { el.hidden = true; return; }
  const what = o.type === 'npc' ? `talk to ${store.data.quests.npcs[o.id!].name}`
    : o.type === 'trainer' ? (store.self?.defeatedTrainers.includes(o.id!) ? `talk to ${store.data.trainers[o.id!].name}`
      : store.data.trainers[o.id!].elite ? eliteHint(o.id!)
      : gymOfLeader(store.data, o.id!) ? `challenge ${store.data.trainers[o.id!].name} for the ${gymOfLeader(store.data, o.id!)!.icon} ${gymOfLeader(store.data, o.id!)!.badge} (friends can walk in to help)`
      : `challenge ${store.data.trainers[o.id!].name}`)
    : o.type === 'shop' ? 'open the shop'
    : o.type === 'fusion' ? 'use the Fusion Lab'
    : o.type === 'heal' ? 'heal your monsters'
    : 'read the sign';
  el.textContent = `Press E to ${what}`;
  el.hidden = false;
}

export function toast(text: string, kind: ToastKind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, text);
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 6) box.lastChild!.remove();
  setTimeout(() => el.classList.add('fade'), 5000);
  setTimeout(() => el.remove(), 5600);
}

// ------------------------------------------------------------ chat

function initChat() {
  const input = $('chatinput') as HTMLInputElement;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) net.send({ t: 'chat', text });
      input.value = '';
      input.blur();
      e.stopPropagation();
    }
  });
}

function addChat(from: string, color: string, text: string) {
  const log = $('chatlog');
  log.append(h('div', { class: 'cl' }, h('b', { style: `color:${color}` }, from + ': '), text));
  while (log.children.length > 60) log.firstChild!.remove();
  log.scrollTop = log.scrollHeight;
}

// ------------------------------------------------------------ buttons

function buildButtons() {
  const el = $('buttons');
  el.append(
    h('button', { onclick: openParty }, 'Party (P)'),
    h('button', { onclick: openBag }, 'Bag (B)'),
    h('button', { onclick: openQuests }, 'Quests (Q)'),
    h('button', { onclick: openHelp }, 'Help (H)'),
  );
  const btn = h('button', { onclick: () => music.toggleMute(), title: 'Toggle music (M)' });
  const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', class: 'vol', title: 'Music volume' }) as HTMLInputElement;
  vol.value = String(music.volume);
  vol.addEventListener('input', () => music.setVolume(Number(vol.value)));
  vol.addEventListener('change', () => vol.blur()); // never keep keyboard focus on the slider
  vol.addEventListener('pointerup', () => vol.blur());
  const sync = () => {
    btn.textContent = music.muted ? '♪ Music: off (M)' : `♪ ${music.songName} (M)`;
    vol.disabled = music.muted;
  };
  music.onChange = sync;
  sync();
  el.prepend(h('span', { class: 'music' }, btn, vol));
}

// ------------------------------------------------------------ overlays

function renderDown() {
  const s = store.self;
  const el = $('overlay-down');
  if (!s || !s.down) { el.hidden = true; return; }
  const left = Math.max(0, (s.respawnAt - store.serverNow()) / 1000);
  el.hidden = false;
  clear(el);
  el.append(h('div', { class: 'down-box' },
    h('div', { class: 'big' }, '💀 Wiped out'),
    h('div', null, 'All your monsters fainted. Nothing is lost: you just have to wait.'),
    h('div', { class: 'countdown' }, `Respawning in town in ${Math.ceil(left)}s`),
    store.world?.boss.phase === 'fight' ? h('div', { class: 'muted' }, s.bossLockUntil > store.serverNow()
      ? `You fell in the boss fight: the portal lets you back in after ${Math.ceil((s.bossLockUntil - store.serverNow()) / 1000)}s.`
      : 'You can rejoin the boss fight through the portal after respawning.') : null));
}

let victoryUntil = 0;
let victoryText = '';
function showVictory(resetIn: number, winners: string[] = [], champion = 'the Champion') {
  victoryUntil = Date.now() + resetIn * 1000;
  victoryText = `${winners.join(' & ') || 'Your team'} defeated ${champion}! Well played, everyone.`;
  renderVictory();
}

function renderVictory() {
  const el = $('overlay-victory');
  const left = (victoryUntil - Date.now()) / 1000;
  if (left <= 0 || store.battle) { el.hidden = true; return; }
  el.hidden = false;
  clear(el);
  el.append(h('div', { class: 'victory-box' },
    h('div', { class: 'big' }, '🏆 Champion defeated! You won the run!'),
    h('div', null, victoryText),
    h('div', { class: 'countdown' }, `A fresh run begins in ${Math.ceil(left)}s`)));
}
