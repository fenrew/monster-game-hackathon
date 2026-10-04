import type { BattleAction, BattleView, EnemyView, Hit, ParticipantView } from '../../shared/types';
import { $, bar, clear, h } from './dom';
import { net } from './net';
import { portraitFor, store, typeChip } from './state';

type Tab = 'fight' | 'bag' | 'swap';
let tab: Tab = 'fight';
let selectedTarget: string | null = null;
let lastBattleId = '';
const prevHp = new Map<string, number>();
let summaryOpen = false;
let lastHitsKey = ''; // battle id + round whose hits we already showed
let summaryTimer = 0;

export function initBattleUI() {
  store.on('battle', render);
  store.on('battleEnd', showSummary);
  const loop = () => {
    updateTimer();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('keydown', (e) => {
    if (document.activeElement instanceof HTMLInputElement) return;
    if (summaryOpen && ['Enter', ' ', 'Escape', 'e', 'E'].includes(e.key)) {
      e.preventDefault();
      closeSummary();
      return;
    }
    const b = store.battle;
    if (!b || tab !== 'fight') return;
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const active = activeMonster(b);
      const ab = active?.abilities[n - 1];
      if (ab) choose({ kind: 'ability', abilityId: ab, targetId: targetFor(b) });
    }
  });
}

function choose(action: BattleAction) {
  net.send({ t: 'action', action });
}

function activeMonster(b: BattleView) {
  return store.self?.party.find((m) => m.uid === b.you.activeUid) ?? null;
}

function targetFor(b: BattleView): string | undefined {
  const alive = b.enemies.filter((e) => !e.fainted);
  if (!alive.find((e) => e.id === selectedTarget)) selectedTarget = alive[0]?.id ?? null;
  return selectedTarget ?? undefined;
}

function updateTimer() {
  const b = store.battle;
  if (!b) return;
  const fill = document.getElementById('btimer-fill');
  const txt = document.getElementById('btime');
  if (!fill || !txt) return;
  const left = Math.max(0, store.battleDeadline - performance.now());
  fill.style.width = `${(left / b.roundMs) * 100}%`;
  fill.classList.toggle('low', left < 3000);
  txt.textContent = `${(left / 1000).toFixed(1)}s`;
}

// ------------------------------------------------------------ render

function render() {
  const b = store.battle;
  const el = $('battle');
  if (!b) return;
  if (b.id !== lastBattleId) {
    lastBattleId = b.id;
    tab = 'fight';
    selectedTarget = null;
    prevHp.clear();
  }
  summaryOpen = false;
  store.modalOpen = false;
  el.hidden = false;
  el.classList.toggle('boss', b.kind === 'boss');
  clear(el);
  targetFor(b);

  const kindLabel = b.kind === 'boss' ? '☠ BOSS FIGHT' : b.kind === 'unique' ? '✦ Unique encounter'
    : b.kind === 'trainer' ? '❗ Trainer battle' : 'Wild battle';
  el.append(
    h('div', { class: 'b-head' },
      h('span', { class: 'b-kind' }, kindLabel, h('span', { class: 'muted' }, ` · ${b.zoneName}`)),
      h('span', { class: 'b-round' }, `Round ${b.round}`),
      h('div', { class: 'b-timer' }, h('div', { id: 'btimer-fill', class: 'fill' })),
      h('span', { id: 'btime', class: 'b-time' }, '')),
  );
  if (b.intent) el.append(h('div', { class: `b-intent${b.intentDanger ? ' danger' : ''}` }, b.intent));
  if (b.trainer) {
    const t = b.trainer;
    el.append(h('div', { class: 'trainer-bar' },
      h('span', { class: 'dot', style: `background:${t.color}` }), h('b', null, t.name),
      h('span', { class: 'tballs', title: `${t.remaining} of ${t.total} monsters left` },
        ...Array.from({ length: t.total }, (_, i) => h('span', { class: i < t.remaining ? 'tball' : 'tball out' })))));
  }
  el.append(
    h('div', { class: 'b-enemies' }, ...b.enemies.map((e) => enemyCard(b, e))),
    alliesRow(b),
    youPanel(b),
    h('div', { class: 'b-log' }, ...(b.log.length ? b.log : ['The fight begins! Choose an action.']).map((l) => h('div', { class: logClass(l) }, l))),
  );
  for (const e of b.enemies) prevHp.set(e.id, e.hp);
  for (const p of b.participants) prevHp.set(p.playerId, p.hp);
  updateTimer();
  // Views are re-sent whenever someone picks an action; only animate each round's hits once.
  const key = `${b.id}:${b.round}`;
  if (key !== lastHitsKey) {
    lastHitsKey = key;
    spawnHits(b.hits);
  }
}

// ------------------------------------------------------------ floating damage numbers

/** Pops RPG-style numbers over whoever lost or gained HP. Targets are found via data-hit attributes. */
function spawnHits(hits: Hit[]) {
  if (!hits?.length) return;
  let layer = document.getElementById('floats');
  if (!layer) {
    layer = h('div', { id: 'floats' });
    document.body.append(layer);
  }
  const perTarget = new Map<string, number>();
  hits.forEach((hit, i) => {
    const el = document.querySelector<HTMLElement>(`[data-hit="${CSS.escape(hit.target)}"]`);
    if (!el) return;
    const n = perTarget.get(hit.target) ?? 0;
    perTarget.set(hit.target, n + 1);
    const r = el.getBoundingClientRect();
    const eff = hit.eff ?? 1;
    const text = hit.kind === 'miss' ? 'MISS'
      : hit.kind === 'heal' ? `+${hit.amount}`
      : hit.kind === 'ability' || hit.kind === 'info' ? hit.text ?? ''
      : `${hit.crit ? 'CRIT ' : ''}-${hit.amount}`;
    const cls = ['float', hit.kind];
    if (hit.crit) cls.push('crit');
    if (hit.kind === 'dmg' && eff > 1) cls.push('super');
    if (hit.kind === 'dmg' && eff < 1) cls.push('weak');
    const sub = hit.kind === 'dmg' && eff > 1 ? 'SUPER EFFECTIVE!' : hit.kind === 'dmg' && eff < 1 ? 'not very effective' : null;
    const f = h('div', { class: cls.join(' ') }, text, sub ? h('div', { class: 'sub' }, sub) : null);
    // Callouts sit above the card; numbers land on it.
    const callout = hit.kind === 'ability';
    const jitter = callout ? 0 : (Math.random() - 0.5) * Math.min(60, r.width * 0.4);
    f.style.left = `${r.left + r.width / 2 + jitter}px`;
    f.style.top = `${callout ? r.top - 4 : r.top + Math.min(r.height * 0.35, 60) + (n % 3) * 8}px`;
    // Play the round in order (who acted, then what it did), capped so big fights stay snappy.
    const delay = hitDelay(i);
    f.style.animationDelay = `${delay}ms`;
    layer!.append(f);
    setTimeout(() => f.remove(), 1800 + delay);
  });
}

const hitDelay = (i: number) => Math.min(i * 170, 2600);

/** Mirrors the server's catch formula (config.json) so orb buttons can show the odds. */
type CatchFn = (catchRate: number, orbMult: number, hp: number, maxHp: number) => number;
let catchFn: CatchFn | null = null;
function catchChance(e: EnemyView, orbMult: number): number {
  const def = store.data.monsters[e.species];
  if (!def) return 0;
  catchFn ??= new Function('catchRate', 'orbMult', 'hp', 'maxHp', `return (${store.data.config.progression.catchFormula});`) as CatchFn;
  const c = catchFn(def.catchRate, orbMult, e.hp, e.maxHp);
  return Math.max(0, Math.min(1, isFinite(c) ? c : 0));
}

function logClass(line: string) {
  if (line.startsWith('⚠')) return 'll warn';
  if (/^Wild .*fainted|and it fainted/.test(line)) return 'll good';
  if (/fainted|wiped/.test(line)) return 'll bad';
  if (/caught|joined/.test(line)) return 'll good';
  return 'll';
}

function enemyCard(b: BattleView, e: EnemyView): HTMLElement {
  const multi = b.enemies.filter((x) => !x.fainted).length > 1;
  const sel = multi && e.id === selectedTarget && !e.fainted;
  const hit = (prevHp.get(e.id) ?? e.hp) > e.hp;
  const size = e.isBoss ? 150 : 84;
  return h('div', {
    class: `ecard${e.isBoss ? ' bosscard' : ''}${e.fainted ? ' fainted' : ''}${sel ? ' sel' : ''}${hit ? ' hit' : ''}${multi && !e.fainted ? ' clickable' : ''}`,
    'data-hit': e.id,
    onclick: () => { if (!e.fainted) { selectedTarget = e.id; render(); } },
    title: multi ? 'Click to target' : '',
  },
    h('div', { class: 'pic', html: portraitFor(e.species, size) }),
    h('div', { class: 'ename' }, e.name, ' ', h('span', { class: 'lv' }, `Lv ${e.level}`)),
    typeChip(e.type),
    bar(e.hp, e.maxHp),
    h('div', { class: 'num' }, e.fainted ? 'Fainted' : `${e.hp} / ${e.maxHp}`),
    sel ? h('div', { class: 'target-tag' }, '🎯 target') : null);
}

function youPanel(b: BattleView): HTMLElement {
  const me = b.participants.find((p) => p.playerId === store.myId);
  const active = activeMonster(b);
  const panel = h('div', { class: 'b-you' });
  if (!me || !active) return panel;
  panel.append(h('div', { class: `choice${b.you.chosen ? ' locked' : ''}` },
    b.you.chosen
      ? `✓ Locked in: ${b.you.choiceLabel}  (you can still change it)`
      : `Choose an action. If you don't: ${b.you.defaultLabel}`));

  const tabs = h('div', { class: 'tabs' },
    tabBtn('fight', 'Fight'), tabBtn('bag', 'Bag'), tabBtn('swap', 'Swap'),
    b.kind !== 'boss' && b.kind !== 'trainer' ? h('button', { class: 'flee', onclick: () => choose({ kind: 'flee' }) }, 'Flee') : null);
  panel.append(tabs);

  const actions = h('div', { class: 'b-actions' });
  if (tab === 'fight') {
    active.abilities.forEach((id, i) => {
      const ab = store.data.abilities[id];
      const t = store.data.types[ab.type];
      const info = ab.power > 0
        ? `${ab.power} pow · ${Math.round(ab.accuracy * 100)}%${ab.target === 'allEnemies' ? ' · all foes' : ''}`
        : ab.target === 'team' ? 'team' : ab.target === 'self' ? 'self' : 'status';
      actions.append(h('button', {
        class: 'abtn', style: `border-left-color:${t.color}`, title: ab.description ?? '',
        onclick: () => choose({ kind: 'ability', abilityId: id, targetId: targetFor(b) }),
      }, h('span', { class: 'key' }, String(i + 1)), h('b', null, ab.name), h('span', { class: 'abinfo' }, info)));
    });
  } else if (tab === 'bag') {
    const s = store.self!;
    const items = Object.entries(s.items).filter(([, n]) => n > 0);
    const target = b.enemies.find((e) => e.id === targetFor(b));
    for (const [id, n] of items) {
      const it = store.data.items[id];
      if (it.kind === 'orb') {
        if (b.kind === 'boss' || b.kind === 'trainer' || !target) continue;
        actions.append(h('button', { class: 'abtn', onclick: () => choose({ kind: 'item', itemId: id, targetId: target.id }) },
          h('b', null, `${it.name} ×${n}`),
          h('span', { class: 'abinfo' }, `throw at ${target.name} · `, h('b', { class: 'chance' }, `${Math.round(catchChance(target, it.catchMult ?? 1) * 100)}% chance`))));
      } else if (it.kind === 'heal') {
        actions.append(h('button', { class: 'abtn', onclick: () => choose({ kind: 'item', itemId: id }) },
          h('b', null, `${it.name} ×${n}`), h('span', { class: 'abinfo' }, `heal ${active.name}`)));
      } else if (it.kind === 'revive') {
        for (const m of s.party.filter((m) => m.hp <= 0)) {
          actions.append(h('button', { class: 'abtn', onclick: () => choose({ kind: 'item', itemId: id, targetId: m.uid }) },
            h('b', null, `${it.name} ×${n}`), h('span', { class: 'abinfo' }, `revive ${m.name}`)));
        }
      }
    }
    if (!actions.childElementCount) actions.append(h('div', { class: 'muted' }, 'Nothing usable right now.'));
  } else {
    const others = store.self!.party.filter((m) => m.uid !== active.uid);
    for (const m of others) {
      actions.append(h('button', { class: 'abtn', disabled: m.hp <= 0, onclick: () => choose({ kind: 'swap', uid: m.uid }) },
        h('b', null, `${m.name} Lv ${m.level}`), h('span', { class: 'abinfo' }, m.hp <= 0 ? 'fainted' : `${m.hp}/${m.maxHp} HP`)));
    }
    if (!others.length) actions.append(h('div', { class: 'muted' }, 'No other monsters in your party.'));
  }
  panel.append(actions);
  return panel;
}

function tabBtn(t: Tab, label: string) {
  return h('button', { class: tab === t ? 'tab on' : 'tab', onclick: () => { tab = t; render(); } }, label);
}

/** Every fighter's active monster as a full card, yours first. Cards shrink as the team grows. */
function alliesRow(b: BattleView): HTMLElement {
  const chosen = b.participants.filter((p) => p.chosen || !p.connected).length;
  const sorted = [...b.participants].sort((a, c) => (a.playerId === store.myId ? -1 : c.playerId === store.myId ? 1 : 0));
  const size = sorted.length <= 4 ? 'lg' : sorted.length <= 8 ? 'md' : 'sm';
  return h('div', { class: 'b-allies-wrap' },
    h('div', { class: 'ph' }, `Your team (${b.participants.length})`, h('span', { class: 'muted' }, `  ${chosen}/${b.participants.length} ready`)),
    h('div', { class: `b-allies ${size}` }, ...sorted.map((p) => allyCard(p, size))));
}

function allyCard(p: ParticipantView, size: 'lg' | 'md' | 'sm'): HTMLElement {
  const me = p.playerId === store.myId;
  const hit = (prevHp.get(p.playerId) ?? p.hp) > p.hp;
  const type = store.data.monsters[p.species]?.type ?? 'neutral';
  const status = !p.connected ? '📴' : p.chosen ? '✓' : '…';
  const statusTitle = !p.connected ? 'Disconnected: uses their default action' : p.chosen ? 'Ready' : 'Choosing...';
  return h('div', { class: `acard${me ? ' me' : ''}${hit ? ' hit' : ''}${p.connected ? '' : ' dc'}`, 'data-hit': p.playerId, style: `--pc:${p.color}` },
    h('div', { class: 'owner' }, h('span', { class: 'dot', style: `background:${p.color}` }), h('span', { class: 'oname', title: me ? 'You' : p.name }, p.name),
      h('span', { class: `ps${p.chosen ? ' ready' : ''}`, title: statusTitle }, status)),
    h('div', { class: 'pic', html: portraitFor(p.species, size === 'lg' ? 72 : size === 'md' ? 56 : 40) }),
    h('div', { class: 'ename' }, p.monsterName, ' ', h('span', { class: 'lv' }, `Lv ${p.level}`)),
    typeChip(type),
    bar(p.hp, p.maxHp),
    h('div', { class: 'num' }, `${p.hp} / ${p.maxHp}`));
}

// ------------------------------------------------------------ summary

function showSummary(result: string, lines: string[], hits?: Hit[]) {
  store.battle = null;
  clearTimeout(summaryTimer);
  if (hits?.length && !$('battle').hidden) {
    // The fight's last round (the knockout) never gets a battle view, so play its numbers before the summary.
    spawnHits(hits);
    store.modalOpen = true;
    summaryTimer = window.setTimeout(() => { if (!store.battle) renderSummary(result, lines); }, hitDelay(hits.length - 1) + 1100);
    return;
  }
  renderSummary(result, lines);
}

function renderSummary(result: string, lines: string[]) {
  const el = $('battle');
  summaryOpen = true;
  store.modalOpen = true;
  el.hidden = false;
  el.classList.remove('boss');
  clear(el);
  el.append(h('div', { class: 'summary' },
    h('div', { class: 'big' }, result === 'wiped' ? '💀 Wiped out' : result === 'fled' ? '🏃 Got away' : result),
    h('div', { class: 'b-log tall' }, ...lines.map((l) => h('div', { class: logClass(l) }, l))),
    h('button', { class: 'primary big', onclick: closeSummary }, 'Continue (Space)')));
}

function closeSummary() {
  summaryOpen = false;
  store.modalOpen = false;
  if (!store.battle) $('battle').hidden = true;
}
