import { battleScreenBusy } from './battleui';
import { $, clear, h } from './dom';
import { evolvePopupShowing } from './evolveui';
import { net } from './net';
import { store } from './state';

// Power picker (TFT-style augments) shown after boss fights: 3 cards, one free reroll, or decide later.

let open = false;
let shownKey = '';
let dismissedKey = '';

export function initAugmentUI() {
  const btn = h('button', { id: 'augbtn', class: 'augbtn', onclick: () => show(true) }, '🎁 Choose a power');
  btn.hidden = true;
  $('buttons').prepend(btn);
  store.on('self', update);
  setInterval(update, 400);
  window.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') {
      e.stopImmediatePropagation();
      later();
    }
  }, true);
}

const offerKey = () => {
  const o = store.self?.augmentOffer;
  return o ? `${o.options.join(',')}|${o.rerolls}|${o.queued}` : '';
};

function update() {
  const o = store.self?.augmentOffer;
  $('augbtn').hidden = !o || open;
  if (!o) {
    if (open) close();
    return;
  }
  const key = offerKey();
  if (open && battleScreenBusy()) {
    close(); // a fight started (e.g. the post-boss duel): pick after it
    return;
  }
  if (open) {
    if (key !== shownKey) show(true);
    return;
  }
  // pop up on its own once the fight, its summary and any evolution popup are out of the way
  if (key !== dismissedKey && !battleScreenBusy() && !evolvePopupShowing() && !store.modalOpen) show(false);
}

function show(force: boolean) {
  const o = store.self?.augmentOffer;
  if (!o) return;
  if (!force && (battleScreenBusy() || store.modalOpen)) return;
  const A = store.data.augments;
  let el = document.getElementById('augments');
  if (!el) {
    el = h('div', { id: 'augments' });
    document.body.append(el);
  }
  clear(el);
  open = true;
  shownKey = offerKey();
  store.modalOpen = true;
  $('augbtn').hidden = true;
  const rarity = A.rarities[o.rarity];
  const cards = o.options.map((id) => {
    const a = A.augments.find((x) => x.id === id)!;
    const r = A.rarities[a.rarity];
    return h('div', { class: 'aug-card', style: `--rc:${r?.color ?? '#fff'}`, onclick: () => pick(id) },
      h('div', { class: 'aug-rarity' }, r?.name ?? a.rarity),
      h('div', { class: 'aug-icon' }, a.icon),
      h('div', { class: 'aug-name' }, a.name),
      h('div', { class: 'aug-desc' }, a.description));
  });
  el.append(h('div', { class: 'aug-box' },
    h('div', { class: 'aug-title' }, 'Choose a power'),
    h('div', { class: 'aug-sub', style: `color:${rarity?.color ?? '#fff'}` },
      `${rarity?.name ?? ''} powers`, o.queued ? h('span', { class: 'muted' }, ` · ${o.queued} more pick${o.queued > 1 ? 's' : ''} waiting`) : null),
    h('div', { class: 'aug-cards' }, ...cards),
    h('div', { class: 'aug-actions' },
      h('button', { disabled: o.rerolls <= 0, onclick: () => net.send({ t: 'augmentReroll' }) }, `🎲 Reroll (${o.rerolls})`),
      h('button', { onclick: later }, 'Decide later'))));
  el.hidden = false;
}

function pick(id: string) {
  net.send({ t: 'augmentPick', id });
  close();
}

function later() {
  dismissedKey = offerKey();
  close();
}

function close() {
  open = false;
  const el = document.getElementById('augments');
  if (el) el.hidden = true;
  store.modalOpen = !$('modal').hidden;
  $('augbtn').hidden = !store.self?.augmentOffer;
}
