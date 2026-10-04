import type { MonsterView, QuestDef } from '../../shared/types';
import { fusionBlocker, fusionCost, fusionLevel, fusionResult } from '../../shared/fusion';
import { recommendedLabel, zoneLevelLabel } from '../../shared/map';
import { $, bar, clear, h } from './dom';
import { net } from './net';
import { portraitFor, store, typeChip } from './state';

// ------------------------------------------------------------ modal plumbing

let current: { title: string; render: () => HTMLElement } | null = null;

function openModal(title: string, render: () => HTMLElement) {
  current = { title, render };
  store.modalOpen = true;
  renderModal();
}

function renderModal() {
  const el = $('modal');
  if (!current) { el.hidden = true; return; }
  const scroll = el.querySelector('.modal-body')?.scrollTop ?? 0;
  clear(el);
  const body = h('div', { class: 'modal-body' }, current.render());
  el.append(h('div', { class: 'modal-box' },
    h('div', { class: 'modal-head' }, h('span', null, current.title), h('button', { class: 'x', onclick: closeModal, title: 'Close (Esc)' }, '✕')),
    body));
  body.scrollTop = scroll;
  el.hidden = false;
}

export function closeModal() {
  current = null;
  store.modalOpen = false;
  $('modal').hidden = true;
}

export function initMenus() {
  store.on('self', () => { if (current) renderModal(); });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
}

// ------------------------------------------------------------ interaction

export function interact() {
  const objs = store.map.objectsNear(store.pos.x, store.pos.y);
  const o = objs.find((o) => o.type === 'npc') ?? objs.find((o) => o.type === 'trainer') ?? objs.find((o) => o.type === 'shop') ?? objs.find((o) => o.type === 'fusion') ?? objs.find((o) => o.type === 'heal') ?? objs.find((o) => o.type === 'sign');
  if (!o) return;
  if (o.type === 'npc') openNpc(o.id!);
  else if (o.type === 'trainer') net.send({ t: 'challenge', id: o.id! });
  else if (o.type === 'shop') openShop();
  else if (o.type === 'fusion') openFusion();
  else if (o.type === 'heal') net.send({ t: 'heal' });
  else if (o.type === 'sign') {
    const z = store.data.zones.find((z) => z.id === o.zone)!;
    store.emit('toast', `${z.name}: ${[zoneLevelLabel(z), recommendedLabel(z.recommended)].filter(Boolean).join(' · ')}` +
      (z.hotspot ? '. Monsters lurk on every tile!' : z.kind === 'grass' ? '. Monsters hide in the tall grass.' : ''), 'info');
  }
}

// ------------------------------------------------------------ party

function monsterCard(m: MonsterView, actions: HTMLElement[], compact = false): HTMLElement {
  const abilities = m.abilities.map((a) => {
    const ab = store.data.abilities[a];
    return h('span', { class: 'ab-chip', style: `border-color:${store.data.types[ab.type].color}`, title: ab.description ?? '' }, ab.name);
  });
  return h('div', { class: `mcard${m.hp <= 0 ? ' fainted' : ''}` },
    h('div', { class: 'pic', html: portraitFor(m.species, compact ? 44 : 64) }),
    h('div', { class: 'minfo' },
      h('div', { class: 'mname' }, m.name, ' ', h('span', { class: 'lv' }, `Lv ${m.level}`), ' ', typeChip(m.type), m.hp <= 0 ? h('span', { class: 'ko' }, ' FAINTED') : null),
      h('div', { class: 'statrow' }, bar(m.hp, m.maxHp), h('span', { class: 'num' }, `${m.hp}/${m.maxHp} HP`)),
      compact ? null : h('div', { class: 'statrow' }, bar(m.xp, m.xpToNext, 'xp'), h('span', { class: 'num' }, `${m.xp}/${m.xpToNext} XP`)),
      compact ? null : h('div', { class: 'muted' }, `ATK ${m.atk} · DEF ${m.def} · SPD ${m.spd}`),
      compact ? null : h('div', { class: 'abilities' }, ...abilities),
      actions.length ? h('div', { class: 'actions' }, ...actions) : null));
}

export function openParty() {
  openModal('Party', () => {
    const s = store.self!;
    const inBattle = !!s.inBattle;
    const wrap = h('div', null);
    if (inBattle) wrap.append(h('div', { class: 'note' }, 'You are in a fight: party changes are locked.'));
    s.party.forEach((m, i) => {
      const acts: HTMLElement[] = [];
      if (!inBattle) {
        if (i > 0) acts.push(h('button', { onclick: () => net.send({ t: 'partyLead', uid: m.uid }) }, 'Make lead'));
        if (s.party.length > 1) acts.push(h('button', { onclick: () => net.send({ t: 'partyStore', uid: m.uid }) }, 'To storage'));
        for (const [id, n] of Object.entries(s.items)) {
          const it = store.data.items[id];
          const ok = (it.kind === 'heal' && m.hp > 0 && m.hp < m.maxHp) || (it.kind === 'revive' && m.hp <= 0);
          if (ok && n > 0) acts.push(h('button', { class: 'item', onclick: () => net.send({ t: 'useItem', item: id, uid: m.uid }) }, `${it.name} (${n})`));
        }
      }
      wrap.append(monsterCard(m, acts));
    });
    if (s.storage.length) {
      wrap.append(h('h3', null, `Storage (${s.storage.length})`));
      for (const m of s.storage) {
        const acts = !inBattle && s.party.length < store.data.config.party.maxSize
          ? [h('button', { onclick: () => net.send({ t: 'partyWithdraw', uid: m.uid }) }, 'To party')] : [];
        wrap.append(monsterCard(m, acts, true));
      }
    }
    wrap.append(h('div', { class: 'muted' }, `The lead (first healthy monster) fights first. Party max ${store.data.config.party.maxSize}; extras go to storage.`));
    return wrap;
  });
}

// ------------------------------------------------------------ bag

export function openBag() {
  openModal('Bag', () => {
    const s = store.self!;
    const rows = Object.entries(s.items).filter(([, n]) => n > 0);
    return h('div', null,
      h('div', { class: 'coins big' }, `🪙 ${s.coins} coins`),
      rows.length ? h('div', { class: 'list' }, ...rows.map(([id, n]) => {
        const it = store.data.items[id];
        return h('div', { class: 'row' }, h('b', null, `${it.name} × ${n}`), h('div', { class: 'muted' }, it.description));
      })) : h('div', { class: 'muted' }, 'Your bag is empty.'),
      h('div', { class: 'muted' }, 'Use healing items from the Party screen, or in battle. Orbs are thrown in battle.'));
  });
}

// ------------------------------------------------------------ quests

function questStatus(q: QuestDef): 'locked' | 'available' | 'active' | 'ready' | 'done' {
  const s = store.self!;
  const st = s.quests[q.id];
  if (st?.state === 'done') return 'done';
  if (st) return q.objectives.every((o, i) => st.progress[i] >= o.count) ? 'ready' : 'active';
  return q.requires.every((r) => s.quests[r]?.state === 'done') ? 'available' : 'locked';
}

function rewardText(q: QuestDef): string {
  const r = q.rewards;
  const parts: string[] = [];
  if (r.coins) parts.push(`${r.coins} coins`);
  for (const [id, n] of Object.entries(r.items ?? {})) parts.push(`${n} × ${store.data.items[id].name}`);
  if (r.rareLuck) parts.push(`rare luck +${r.rareLuck}`);
  if (r.monster) parts.push(store.data.monsters[r.monster.species].name);
  if (r.uniqueEncounter) parts.push('??? a unique encounter');
  return parts.join(', ');
}

function questRow(q: QuestDef, withButtons: boolean): HTMLElement {
  const s = store.self!;
  const status = questStatus(q);
  const st = s.quests[q.id];
  const badge = { locked: '🔒 Locked', available: '! Available', active: '… In progress', ready: '✔ Ready to turn in', done: '✓ Done' }[status];
  const row = h('div', { class: `quest ${status}` },
    h('div', { class: 'qhead' }, h('b', null, q.name), h('span', { class: 'qbadge' }, badge)),
    h('div', null, q.description),
    st && status !== 'done' ? h('div', { class: 'muted' }, q.objectives.map((o, i) => `${o.label}: ${st.progress[i]}/${o.count}`).join(' · ')) : null,
    h('div', { class: 'muted' }, `Reward: ${rewardText(q)}`));
  if (withButtons) {
    if (status === 'available') row.append(h('button', { onclick: () => net.send({ t: 'questAccept', id: q.id }) }, 'Accept'));
    if (status === 'ready') row.append(h('button', { class: 'primary', onclick: () => net.send({ t: 'questTurnIn', id: q.id }) }, 'Turn in'));
  } else if (status === 'available' || status === 'ready') {
    row.append(h('div', { class: 'muted' }, `Talk to ${store.data.quests.npcs[q.giver].name} in town.`));
  }
  return row;
}

export function openQuests() {
  openModal('Quests', () => {
    const order = { ready: 0, active: 1, available: 2, locked: 3, done: 4 };
    const qs = [...store.data.quests.quests].sort((a, b) => order[questStatus(a)] - order[questStatus(b)]);
    return h('div', null, ...qs.map((q) => questRow(q, false)));
  });
}

export function openNpc(id: string) {
  const npc = store.data.quests.npcs[id];
  openModal(npc.name, () => h('div', null,
    h('div', { class: 'greeting' }, `“${npc.greeting}”`),
    ...store.data.quests.quests.filter((q) => q.giver === id).map((q) => questRow(q, true))));
}

// ------------------------------------------------------------ shop

export function openShop() {
  openModal('Shop', () => {
    const s = store.self!;
    const items = Object.entries(store.data.items).filter(([, it]) => it.price > 0);
    return h('div', null,
      h('div', { class: 'coins big' }, `🪙 ${s.coins} coins`),
      h('div', { class: 'list' }, ...items.map(([id, it]) => h('div', { class: 'row shoprow' },
        h('div', null, h('b', null, it.name), ` · ${it.price} coins`, h('span', { class: 'muted' }, `  (have ${s.items[id] ?? 0})`),
          h('div', { class: 'muted' }, it.description)),
        h('div', { class: 'actions' },
          h('button', { disabled: s.coins < it.price, onclick: () => net.send({ t: 'buy', item: id, qty: 1 }) }, 'Buy 1'),
          h('button', { disabled: s.coins < it.price * 5, onclick: () => net.send({ t: 'buy', item: id, qty: 5 }) }, 'Buy 5'))))));
  });
}

// ------------------------------------------------------------ fusion lab

let fuseA: string | null = null;
let fuseB: string | null = null;

export function openFusion() {
  openModal('⚗ Fusion Lab', () => {
    const s = store.self!;
    const d = store.data;
    const all = [...s.party, ...s.storage];
    if (!all.some((m) => m.uid === fuseA)) fuseA = null;
    if (!all.some((m) => m.uid === fuseB)) fuseB = null;
    const A = all.find((m) => m.uid === fuseA) ?? null;
    const B = all.find((m) => m.uid === fuseB) ?? null;

    const slot = (m: MonsterView | null, clearIt: () => void) => h('div', {
      class: `fslot${m ? ' filled' : ''}`, title: m ? 'Click to remove' : '', onclick: () => { if (m) { clearIt(); openFusion(); } },
    }, ...(m
      ? [h('div', { html: portraitFor(m.species, 64) }), h('b', null, m.name), h('span', { class: 'lv' }, `Lv ${m.level}`), typeChip(m.type)]
      : [h('div', { class: 'muted' }, 'Pick a monster below')]));

    let preview: HTMLElement;
    let fuseBtn: HTMLElement | null = null;
    if (A && B) {
      const result = fusionResult(d, A.species, B.species);
      if (result) {
        const level = fusionLevel(d, A.level, B.level);
        const cost = fusionCost(d, level);
        const rd = d.monsters[result];
        preview = h('div', { class: 'fslot result filled' },
          h('div', { html: portraitFor(result, 72) }), h('b', null, rd.name), h('span', { class: 'lv' }, `Lv ${level}`), typeChip(rd.type));
        const poor = s.coins < cost;
        fuseBtn = h('div', { class: 'fuse-go' },
          h('button', {
            class: 'primary big', disabled: poor,
            onclick: () => { net.send({ t: 'fuse', a: A.uid, b: B.uid }); fuseA = fuseB = null; },
          }, `Fuse for ${cost} coins`),
          h('div', { class: 'muted' }, poor ? `You have ${s.coins} coins.` : `${A.name} and ${B.name} will be used up.`));
      } else {
        preview = h('div', { class: 'fslot result' }, h('div', { class: 'muted' }, 'No recipe for this pair'));
      }
    } else {
      preview = h('div', { class: 'fslot result' }, h('div', { class: 'big' }, '?'));
    }

    const pick = (uid: string) => {
      if (!fuseA) fuseA = uid;
      else if (!fuseB) fuseB = uid;
      else fuseB = uid;
      openFusion();
    };
    const rows = all.map((m) => {
      const why = fusionBlocker(d, m.species, m.level);
      const chosen = m.uid === fuseA || m.uid === fuseB;
      const where = s.party.includes(m) ? 'party' : 'storage';
      return h('div', { class: `frow${chosen ? ' chosen' : ''}` },
        h('div', { html: portraitFor(m.species, 34) }),
        h('div', { class: 'fname' }, h('b', null, m.name), h('span', { class: 'lv' }, ` Lv ${m.level}`), ' ', typeChip(m.type),
          h('span', { class: 'muted' }, `  ${where}`)),
        h('button', { disabled: !!why || chosen, onclick: () => pick(m.uid) }, chosen ? 'Picked' : why ?? 'Pick'));
    });

    const recipes = d.fusions.recipes.map((r) => {
      const rd = d.monsters[r.result];
      return h('div', { class: 'recipe' }, typeChip(r.types[0]), ' + ', typeChip(r.types[1]), ' → ',
        h('span', { html: portraitFor(r.result, 28) }), h('b', null, rd.name));
    });

    return h('div', null,
      h('div', { class: 'coins big' }, `🪙 ${s.coins} coins`),
      h('div', { class: 'fusion-row' }, slot(A, () => { fuseA = null; }), h('div', { class: 'fop' }, '+'), slot(B, () => { fuseB = null; }),
        h('div', { class: 'fop' }, '='), preview),
      fuseBtn,
      h('h3', null, 'Your monsters'),
      h('div', { class: 'list' }, ...rows),
      h('h3', null, 'Recipe book'),
      h('div', { class: 'recipes' }, ...recipes),
      h('div', { class: 'muted' }, `The result's level is the higher parent's level. Cost grows with that level. Parents need Lv ${d.fusions.minLevel}+.`));
  });
}

// ------------------------------------------------------------ help

export function openHelp() {
  const c = store.data.config;
  openModal('How to play', () => h('div', { class: 'help' },
    h('p', null, h('b', null, 'Goal: '), `Every ${Math.round(c.boss.intervalSeconds / 60)} minutes a boss pulls the whole server into the arena. Defeat ${c.boss.bossesToWin} bosses to win. Every run starts fresh.`),
    h('p', null, h('b', null, 'Move: '), 'WASD / arrow keys.  ', h('b', null, 'Interact: '), 'E or Space.  ', h('b', null, 'Chat: '), 'Enter.'),
    h('p', null, h('b', null, 'Menus: '), 'P party · B bag · Q quests · H help · M music · Esc closes.'),
    h('p', null, h('b', null, 'Lead monster: '), 'Click a monster in the left sidebar (or press 1-6) to make it your lead: it starts your next fight.'),
    h('p', null, h('b', null, 'Zones: '), 'Ground colour, minimap tint and signposts show each zone\'s level range and recommended party size. Green is easy; yellow, orange and red get harder. Wild monsters hide in tall grass; in the Crystal Cave they lurk everywhere.'),
    h('p', null, h('b', null, 'Combat: '), `Everyone picks an action within ${c.combat.roundSeconds}s. If you don't choose, your monster repeats its last ability. Order: flee, then items and swaps, then abilities by speed.`),
    h('p', null, h('b', null, 'Co-op: '), `Players within ${c.combat.encounterPullRadius} tiles get pulled into a fight, and anyone can walk into a fight marked ⚔ on the map. Everyone gets full XP.`),
    h('p', null, h('b', null, 'Trainers: '), 'Trainers around the map battle you when you walk into their line of sight (the arrow shows where they look), or when you press E next to them. They send out their monsters one at a time. You can\'t flee or catch, but they pay well and give bonus XP.'),
    h('p', null, h('b', null, 'Fusion Lab: '), 'In town, fuse two of your monsters (Lv ' + store.data.fusions.minLevel + '+) into a fusion-only species. The two types decide the result. Both parents are used up, and it costs coins.'),
    h('p', null, h('b', null, 'Types: '), 'Spark beats Tide, Tide beats Stone, Stone beats Spark.'),
    h('p', null, h('b', null, 'Bosses: '), 'Watch the boss intent banner. When a boss charges a big attack, use Guard (yourself) or Bulwark (the whole team).'),
    h('p', null, h('b', null, 'Wipes: '), `If all your monsters faint, you respawn in town after ${c.respawnSeconds}s with a healed team. If a boss fight is still going, rejoin through the portal.`)));
}

// ------------------------------------------------------------ join / starter

export function showJoin(mode: 'join' | 'pick') {
  const el = $('join');
  clear(el);
  let chosen = store.data.config.start.starters[0];
  const nameInput = h('input', { id: 'nameinput', placeholder: 'Your name', maxlength: '16', autocomplete: 'off' }) as HTMLInputElement;
  try { nameInput.value = localStorage.getItem('stb-name') ?? ''; } catch { /* ignore */ }
  const cards = store.data.config.start.starters.map((id) => {
    const m = store.data.monsters[id];
    const card = h('div', { class: 'starter', onclick: () => { chosen = id; cards.forEach((c) => c.classList.toggle('sel', c === card)); } },
      h('div', { html: portraitFor(id, 96) }),
      h('div', { class: 'sname' }, m.name), typeChip(m.type),
      h('div', { class: 'muted' }, m.description ?? ''));
    if (id === chosen) card.classList.add('sel');
    return card;
  });
  const go = () => {
    if (mode === 'join') {
      const name = nameInput.value.trim();
      try { localStorage.setItem('stb-name', name); } catch { /* ignore */ }
      net.send({ t: 'join', name, starter: chosen });
    } else {
      net.send({ t: 'pickStarter', starter: chosen });
    }
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  el.append(h('div', { class: 'join-box' },
    h('h1', null, 'Survive the Bosses'),
    h('div', { class: 'tagline' }, mode === 'join'
      ? 'Catch monsters, level up with friends, and survive a boss every 5 minutes.'
      : 'A new run begins! Choose your starter.'),
    mode === 'join' ? nameInput : null,
    h('div', { class: 'starters' }, ...cards),
    h('button', { class: 'primary big', onclick: go }, mode === 'join' ? 'Play' : 'Choose')));
  el.hidden = false;
  if (mode === 'join') setTimeout(() => nameInput.focus(), 50);
}

export function hideJoin() {
  $('join').hidden = true;
}
