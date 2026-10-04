import type { BattleAction, BattleView, EnemyView } from '../../shared/types';
import { $, bar, clear, h } from './dom';
import { net } from './net';
import { portraitFor, store, typeChip } from './state';

type Tab = 'fight' | 'bag' | 'swap';
let tab: Tab = 'fight';
let selectedTarget: string | null = null;
let lastBattleId = '';
const prevHp = new Map<string, number>();
let summaryOpen = false;

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

  const kindLabel = b.kind === 'boss' ? '☠ BOSS FIGHT' : b.kind === 'unique' ? '✦ Unique encounter' : 'Wild battle';
  el.append(
    h('div', { class: 'b-head' },
      h('span', { class: 'b-kind' }, kindLabel, h('span', { class: 'muted' }, ` · ${b.zoneName}`)),
      h('span', { class: 'b-round' }, `Round ${b.round}`),
      h('div', { class: 'b-timer' }, h('div', { id: 'btimer-fill', class: 'fill' })),
      h('span', { id: 'btime', class: 'b-time' }, '')),
  );
  if (b.intent) el.append(h('div', { class: `b-intent${b.intentDanger ? ' danger' : ''}` }, b.intent));
  el.append(
    h('div', { class: 'b-enemies' }, ...b.enemies.map((e) => enemyCard(b, e))),
    h('div', { class: 'b-main' }, youPanel(b), participantsPanel(b)),
    h('div', { class: 'b-log' }, ...(b.log.length ? b.log : ['The fight begins! Choose an action.']).map((l) => h('div', { class: logClass(l) }, l))),
  );
  for (const e of b.enemies) prevHp.set(e.id, e.hp);
  for (const p of b.participants) prevHp.set(p.playerId, p.hp);
  updateTimer();
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
  const hit = (prevHp.get(me.playerId) ?? me.hp) > me.hp;
  panel.append(h('div', { class: `you-card${hit ? ' hit' : ''}` },
    h('div', { class: 'pic', html: portraitFor(me.species, 64) }),
    h('div', { class: 'minfo' },
      h('div', { class: 'mname' }, me.monsterName, ' ', h('span', { class: 'lv' }, `Lv ${me.level}`), ' ', typeChip(active.type)),
      h('div', { class: 'statrow' }, bar(me.hp, me.maxHp), h('span', { class: 'num' }, `${me.hp}/${me.maxHp}`)))));

  panel.append(h('div', { class: `choice${b.you.chosen ? ' locked' : ''}` },
    b.you.chosen
      ? `✓ Locked in: ${b.you.choiceLabel}  (you can still change it)`
      : `Choose an action. If you don't: ${b.you.defaultLabel}`));

  const tabs = h('div', { class: 'tabs' },
    tabBtn('fight', 'Fight'), tabBtn('bag', 'Bag'), tabBtn('swap', 'Swap'),
    b.kind !== 'boss' ? h('button', { class: 'flee', onclick: () => choose({ kind: 'flee' }) }, 'Flee') : null);
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
        if (b.kind === 'boss' || !target) continue;
        actions.append(h('button', { class: 'abtn', onclick: () => choose({ kind: 'item', itemId: id, targetId: target.id }) },
          h('b', null, `${it.name} ×${n}`), h('span', { class: 'abinfo' }, `throw at ${target.name}`)));
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

function participantsPanel(b: BattleView): HTMLElement {
  const chosen = b.participants.filter((p) => p.chosen || !p.connected).length;
  const sorted = [...b.participants].sort((a, c) => (a.playerId === store.myId ? -1 : c.playerId === store.myId ? 1 : 0));
  return h('div', { class: 'b-party' },
    h('div', { class: 'ph' }, `Fighters (${b.participants.length})`, h('span', { class: 'muted' }, `  ${chosen}/${b.participants.length} ready`)),
    h('div', { class: 'plist' }, ...sorted.map((p) => h('div', { class: `prow${p.playerId === store.myId ? ' me' : ''}${p.connected ? '' : ' dc'}` },
      h('span', { class: 'dot', style: `background:${p.color}` }),
      h('span', { class: 'pn' }, p.name),
      h('span', { class: 'pm' }, `${p.monsterName} ${p.level}`),
      bar(p.hp, p.maxHp),
      h('span', { class: 'ps', title: p.connected ? (p.chosen ? 'Ready' : 'Choosing...') : 'Disconnected: uses default action' },
        !p.connected ? '📴' : p.chosen ? '✓' : '…')))));
}

// ------------------------------------------------------------ summary

function showSummary(result: string, lines: string[]) {
  const el = $('battle');
  store.battle = null;
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
