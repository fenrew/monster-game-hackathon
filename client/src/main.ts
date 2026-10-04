import { initBattleUI } from './battleui';
import { initAugmentUI } from './augmentui';
import { initEvolveUI } from './evolveui';
import { $ } from './dom';
import { initHud, toast } from './hud';
import { closeModal, hideJoin, initMenus, openHelp, showJoin } from './menus';
import { net } from './net';
import { store } from './state';
import { initMusic } from './music';
import { createGame } from './world';

let uiReady = false;
let gameStarted = false;
let joinMode: 'join' | 'pick' | null = null;
let lastBattleId = '';

function setJoin(mode: 'join' | 'pick' | null) {
  if (mode === joinMode) return;
  joinMode = mode;
  if (mode) showJoin(mode);
  else hideJoin();
}

function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  initHud();
  initAugmentUI();
  createGame('game');
  let seen = false;
  try { seen = !!localStorage.getItem('stb-help-seen'); localStorage.setItem('stb-help-seen', '1'); } catch { /* ignore */ }
  if (!seen) setTimeout(openHelp, 300);
}

net.onStatus = (s) => {
  $('conn').hidden = !(gameStarted && s !== 'open');
};

net.onMessage = (msg) => {
  switch (msg.t) {
    case 'hello':
      store.setData(msg.data);
      if (!uiReady) {
        uiReady = true;
        initMenus();
        initBattleUI();
        initEvolveUI();
      }
      if (!net.hasToken && !gameStarted) setJoin('join');
      break;
    case 'resumeFailed':
      if (gameStarted) location.reload(); // our session expired while away: start over cleanly
      else setJoin('join');
      break;
    case 'welcome':
      store.myId = msg.id;
      setJoin(null);
      startGame();
      break;
    case 'error':
      toast(msg.text, 'bad');
      break;
    case 'self':
      store.self = msg.self;
      if (gameStarted) setJoin(msg.self.needsStarter ? 'pick' : null);
      store.emit('self');
      break;
    case 'world':
      store.world = msg.world;
      store.serverOffset = msg.world.serverNow - Date.now();
      store.emit('world');
      break;
    case 'pos':
      store.pos = { x: msg.x, y: msg.y };
      store.emit('pos', !!msg.teleport);
      break;
    case 'battle':
      if (msg.battle.id !== lastBattleId) {
        lastBattleId = msg.battle.id;
        closeModal();
      }
      store.battle = msg.battle;
      store.battleDeadline = performance.now() + msg.battle.remainingMs;
      store.emit('battle');
      break;
    case 'battleEnd':
      store.emit('battleEnd', msg.result, msg.summary, msg.hits);
      break;
    case 'toast':
      store.emit('toast', msg.text, msg.kind);
      break;
    case 'chat':
      store.emit('chat', msg.from, msg.color, msg.text);
      break;
    case 'evolved':
      store.emit('evolved', msg);
      break;
    case 'victory':
      store.emit('victory', msg.resetIn, msg.winners, msg.champion);
      break;
  }
};

// Debug handle for the browser console (and automated tests): inspect window.__stb.
(window as unknown as { __stb: typeof store }).__stb = store;

// Soundtrack follows the action: boss fights, other battles, or exploring.
initMusic(() => (store.battle?.kind === 'boss' ? 'boss' : store.battle ? 'battle' : 'overworld'));

net.connect();
