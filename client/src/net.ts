import type { ClientMsg, ServerMsg } from '../../shared/types';

const TOKEN_KEY = 'stb-token';

function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: reconnect just won't resume */ }
}

/** WebSocket wrapper with automatic reconnect + session resume. */
export class Net {
  private ws: WebSocket | null = null;
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (status: 'connecting' | 'open' | 'closed') => void = () => {};

  connect() {
    this.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus('open');
      const token = getToken();
      if (token) this.send({ t: 'resume', token });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') setToken(msg.token);
      if (msg.t === 'resumeFailed') setToken(null);
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onStatus('closed');
      setTimeout(() => this.connect(), 1500);
    };
  }

  get hasToken() {
    return !!getToken();
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export const net = new Net();
