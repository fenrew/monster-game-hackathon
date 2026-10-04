import type { ServerMsg } from '../../shared/types';
import { battleScreenBusy } from './battleui';
import { $, clear, h } from './dom';
import { portraitFor, store, tierBadge } from './state';

type Evolved = Extract<ServerMsg, { t: 'evolved' }>;

// Big celebratory popup for evolutions and fusions. Queued so it never covers a fight or its summary.
const queue: Evolved[] = [];
let showing = false;
let current: Evolved | null = null;
let closeTimer = 0;

export function initEvolveUI() {
  // a fight starting (e.g. the post-boss duel) pushes the popup aside; it replays afterwards
  store.on('battle', () => {
    if (showing && current) {
      queue.unshift(current);
      close();
    }
  });
  store.on('evolved', (m: Evolved) => {
    queue.push(m);
    tryShow();
  });
  setInterval(tryShow, 300);
  window.addEventListener('keydown', (e) => {
    if (showing && ['Enter', ' ', 'Escape'].includes(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }, true);
}

/** True while the evolution/fusion popup is on screen. */
export function evolvePopupShowing() {
  return showing || queue.length > 0;
}

function busy() {
  return battleScreenBusy();
}

function tryShow() {
  if (showing || !queue.length || busy()) return;
  show(queue.shift()!);
}

function name(species: string) {
  return store.data.monsters[species]?.name ?? species;
}

function show(m: Evolved) {
  showing = true;
  current = m;
  store.modalOpen = true;
  let el = document.getElementById('evolve');
  if (!el) {
    el = h('div', { id: 'evolve' });
    el.addEventListener('click', close);
    document.body.append(el);
  }
  clear(el);
  el.hidden = false;
  const fusion = m.kind === 'fusion';
  const title = h('div', { class: 'ev-title' }, fusion ? '⚗ Fusion in progress...' : `What? ${name(m.from[0])} is evolving!`);
  const before = h('div', { class: 'ev-before' }, ...m.from.map((s) => h('div', { class: 'ev-pic', html: portraitFor(s, 150) })));
  const after = h('div', { class: 'ev-after', html: portraitFor(m.to, 190, m.tier) });
  const stage = h('div', { class: `ev-stage${fusion ? ' fusion' : ''}` },
    h('div', { class: 'ev-rays' }), before, after,
    ...Array.from({ length: 10 }, (_, i) => h('span', { class: 'ev-spark', style: `--a:${i * 36}deg;--d:${(i % 3) * 0.12}s` }, '✦')));
  const result = h('div', { class: 'ev-result' },
    h('div', { class: 'ev-big' }, fusion ? 'Fusion complete!' : 'Congratulations!'),
    h('div', null, fusion
      ? `${m.from.map(name).join(' + ')} became `
      : `Your ${name(m.from[0])} evolved into `, tierBadge(m.tier), ' ', h('b', null, name(m.to)), fusion ? ` (Lv ${m.level})` : '!'),
    h('div', { class: 'muted' }, 'Click or press Space to continue'));
  el.append(h('div', { class: 'ev-box' }, title, stage, result));
  // the reveal: flashing silhouette -> burst -> new form
  setTimeout(() => {
    stage.classList.add('reveal');
    title.textContent = fusion ? '⚗ Fusion!' : '✨ Evolution!';
  }, 1700);
  setTimeout(() => result.classList.add('show'), 2100);
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(close, 7000);
}

function close() {
  if (!showing) return;
  showing = false;
  current = null;
  clearTimeout(closeTimer);
  const el = document.getElementById('evolve');
  if (el) el.hidden = true;
  store.modalOpen = !$('modal').hidden; // a menu (e.g. the Fusion Lab) may still be open underneath
  setTimeout(tryShow, 250);
}
