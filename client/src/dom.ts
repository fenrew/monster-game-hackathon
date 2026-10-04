type Child = Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  style?: string;
  title?: string;
  html?: string; // trusted markup only (e.g. generated SVG)
  onclick?: (e: MouseEvent) => void;
  disabled?: boolean;
  [attr: string]: unknown;
}

/** Creates an element. Strings become text nodes, so user content is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'onclick') el.addEventListener('click', v as (e: Event) => void);
      else if (k === 'disabled') (el as HTMLButtonElement).disabled = !!v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function bar(value: number, max: number, cls = 'hp'): HTMLElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const tone = cls === 'hp' ? (pct > 50 ? 'ok' : pct > 20 ? 'mid' : 'low') : '';
  return h('div', { class: `bar ${cls} ${tone}` }, h('div', { class: 'fill', style: `width:${pct}%` }));
}

export function fmtTime(s: number): string {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
