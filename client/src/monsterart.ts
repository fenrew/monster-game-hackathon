// Hand-drawn (in code) SVG art for every monster species: gradients, outlines, highlights and type effects.
// Each species has its own silhouette; evolutions read as bigger, fiercer versions of their base form.
// viewBox is 0 0 100 100, ground shadow around y = 90.

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

interface Ctx {
  c: string;   // base colour
  dk: string;  // dark
  lt: string;  // light
  ln: string;  // outline
  S: string;   // outline stroke attributes
  /** Radial body shading (light top-left, dark bottom-right). Returns a fill value. */
  shade(name: string, color?: string): string;
  /** Linear gradient from stops. Returns a fill value. */
  lin(name: string, stops: [number, string, number?][], vertical?: boolean): string;
  /** Soft glow (colour fading to transparent). Returns a fill value. */
  glow(name: string, color: string): string;
}

function makeCtx(color: string, prefix: string): { ctx: Ctx; defs: string[] } {
  const defs: string[] = [];
  const ln = shade(color, -0.72);
  const ctx: Ctx = {
    c: color,
    dk: shade(color, -0.38),
    lt: shade(color, 0.5),
    ln,
    S: `stroke="${ln}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`,
    shade(name, col = color) {
      const id = `${prefix}-${name}`;
      defs.push(`<radialGradient id="${id}" cx="35%" cy="28%" r="78%"><stop offset="0" stop-color="${shade(col, 0.55)}"/><stop offset="0.5" stop-color="${col}"/><stop offset="1" stop-color="${shade(col, -0.42)}"/></radialGradient>`);
      return `url(#${id})`;
    },
    lin(name, stops, vertical = true) {
      const id = `${prefix}-${name}`;
      const xy = vertical ? 'x1="0" y1="0" x2="0" y2="1"' : 'x1="0" y1="0" x2="1" y2="1"';
      defs.push(`<linearGradient id="${id}" ${xy}>${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`);
      return `url(#${id})`;
    },
    glow(name, col) {
      const id = `${prefix}-${name}`;
      defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${col}" stop-opacity="0.9"/><stop offset="0.45" stop-color="${col}" stop-opacity="0.35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`);
      return `url(#${id})`;
    },
  };
  return { ctx, defs };
}

interface EyeOpts { iris?: string; fierce?: 'l' | 'r'; glow?: string; sleepy?: boolean; lid?: string }

/** Big expressive eye. `fierce` adds a slanted brow (l = left eye, r = right eye); `glow` makes it a glowing eye. */
function eye(x: number, y: number, r: number, ln: string, o: EyeOpts = {}): string {
  if (o.glow) {
    return `<ellipse cx="${x}" cy="${y}" rx="${r * 1.15}" ry="${r * 0.8}" fill="${o.glow}" stroke="${ln}" stroke-width="1.8"/>`
      + `<ellipse cx="${x}" cy="${y}" rx="${r * 0.5}" ry="${r * 0.3}" fill="#fff"/>`
      + (o.fierce ? brow(x, y, r, ln, o.fierce) : '');
  }
  const iris = o.iris ?? '#2b2b2b';
  let s = `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.12}" fill="#fff" stroke="${ln}" stroke-width="1.8"/>`
    + `<circle cx="${x + r * 0.12}" cy="${y + r * 0.12}" r="${r * 0.66}" fill="${iris}"/>`
    + `<circle cx="${x + r * 0.15}" cy="${y + r * 0.15}" r="${r * 0.34}" fill="#111"/>`
    + `<circle cx="${x - r * 0.18}" cy="${y - r * 0.25}" r="${r * 0.26}" fill="#fff"/>`
    + `<circle cx="${x + r * 0.38}" cy="${y + r * 0.38}" r="${r * 0.12}" fill="#fff"/>`;
  if (o.sleepy) s += `<path d="M${x - r * 1.05} ${y - r * 0.1} Q${x} ${y - r * 1.5} ${x + r * 1.05} ${y - r * 0.1} Z" fill="${o.lid ?? ln}" stroke="${ln}" stroke-width="1.5"/>`;
  if (o.fierce) s += brow(x, y, r, ln, o.fierce);
  return s;
}

function brow(x: number, y: number, r: number, ln: string, side: 'l' | 'r'): string {
  const d = side === 'l' ? 1 : -1; // slant down towards the nose
  return `<path d="M${x - d * r * 1.2} ${y - r * 1.55} L${x + d * r * 1.0} ${y - r * 0.85}" stroke="${ln}" stroke-width="${r * 0.55}" stroke-linecap="round"/>`;
}

function bolt(x: number, y: number, s: number, fill: string, ln: string, rot = 0): string {
  return `<polygon transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" points="0,-10 6,-2 1,-1 5,10 -5,0 0,-1 -4,-10" fill="${fill}" stroke="${ln}" stroke-width="${1.6 / s}" stroke-linejoin="round"/>`;
}

function sparkle(x: number, y: number, r: number, fill: string): string {
  return `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;
}

function drop(x: number, y: number, s: number, fill: string, ln: string): string {
  return `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -6 Q5 1 0 5 Q-5 1 0 -6 Z" fill="${fill}" stroke="${ln}" stroke-width="${1.2 / s}"/>`;
}

/** A star polygon (spiky mane / crown) around (cx, cy). */
function spikes(cx: number, cy: number, n: number, rOut: number, rIn: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 === 0 ? rOut : rIn;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

const ART: Record<string, (k: Ctx) => string> = {
  // ============================================================ ★3 species (fusion only)
  fulgurion: (k) => {
    const body = k.shade('b');
    const mane = k.lin('m', [[0, '#ffffff'], [0.4, '#fff27a'], [1, '#ff9f1a']]);
    return `
      <circle cx="50" cy="44" r="44" fill="${k.glow('g', '#fff27a')}"/>
      <path d="M74 70 Q94 66 90 46" fill="none" stroke="${k.ln}" stroke-width="7" stroke-linecap="round"/>
      <path d="M74 70 Q94 66 90 46" fill="none" stroke="${k.c}" stroke-width="4" stroke-linecap="round"/>
      ${bolt(90, 40, 0.6, '#fff27a', k.ln, 10)}
      <rect x="32" y="74" width="9" height="16" rx="4" fill="${k.dk}" ${k.S}/><rect x="62" y="74" width="9" height="16" rx="4" fill="${k.dk}" ${k.S}/>
      <ellipse cx="54" cy="70" rx="25" ry="15" fill="${body}" ${k.S}/>
      <polygon points="${spikes(50, 42, 13, 31, 19, -Math.PI / 2)}" fill="${mane}" ${k.S}/>
      <path d="M14 30 l6 4 -3 2 6 4 M86 22 l-6 4 3 2 -6 4" fill="none" stroke="#fff27a" stroke-width="2"/>
      <circle cx="50" cy="44" r="15" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="51" rx="8" ry="6" fill="${k.lt}" ${k.S}/>
      <path d="M47 47 L53 47 L50 50 Z" fill="${k.ln}"/>
      <polygon points="45,55 46.5,59 48,55" fill="#fff"/><polygon points="52,55 53.5,59 55,55" fill="#fff"/>
      ${eye(44, 40, 3.6, k.ln, { glow: '#7fd8ff', fierce: 'l' })}${eye(56, 40, 3.6, k.ln, { glow: '#7fd8ff', fierce: 'r' })}`;
  },
  magnetaur: (k) => {
    const metal = k.shade('b');
    const horn = (flip: number) => {
      const x = (v: number) => 50 + (v - 50) * flip;
      return `<path d="M${x(38)} 28 Q${x(18)} 26 ${x(20)} 8" fill="none" stroke="${k.ln}" stroke-width="11" stroke-linecap="round"/>
        <path d="M${x(38)} 28 Q${x(18)} 26 ${x(20)} 8" fill="none" stroke="#c0392b" stroke-width="7" stroke-linecap="round"/>
        <rect x="${x(20) - 5}" y="4" width="10" height="7" rx="2" fill="#ecf0f1" ${k.S}/>`;
    };
    return `
      <circle cx="50" cy="20" r="26" fill="${k.glow('g', '#fff27a')}"/>
      ${horn(1)}${horn(-1)}
      <path d="M22 6 l9 4 -4 3 10 3 -4 3 12 1 -4 3 18 -3" fill="none" stroke="#fff27a" stroke-width="2.2"/>
      <rect x="22" y="72" width="16" height="18" rx="5" fill="${k.dk}" ${k.S}/><rect x="62" y="72" width="16" height="18" rx="5" fill="${k.dk}" ${k.S}/>
      <path d="M14 78 Q12 44 50 40 Q88 44 86 78 Z" fill="${metal}" ${k.S}/>
      <circle cx="24" cy="56" r="2" fill="${k.ln}"/><circle cx="76" cy="56" r="2" fill="${k.ln}"/><circle cx="30" cy="70" r="2" fill="${k.ln}"/><circle cx="70" cy="70" r="2" fill="${k.ln}"/>
      <circle cx="50" cy="62" r="11" fill="${k.glow('c', '#fff27a')}"/><circle cx="50" cy="62" r="5" fill="#fffbe0" ${k.S}/>
      <rect x="35" y="20" width="30" height="28" rx="10" fill="${metal}" ${k.S}/>
      <ellipse cx="50" cy="42" rx="10" ry="7" fill="${k.lt}" ${k.S}/>
      <circle cx="46" cy="42" r="1.8" fill="${k.ln}"/><circle cx="54" cy="42" r="1.8" fill="${k.ln}"/>
      <path d="M45 47 Q50 52 55 47" fill="none" stroke="#f1c40f" stroke-width="2.4"/>
      ${eye(43, 31, 3.4, k.ln, { glow: '#fff27a', fierce: 'l' })}${eye(57, 31, 3.4, k.ln, { glow: '#fff27a', fierce: 'r' })}`;
  },
  titanox: (k) => {
    const body = k.shade('b');
    return `
      <polygon points="40,46 46,34 52,46" fill="${k.dk}" ${k.S}/><polygon points="54,46 61,32 66,46" fill="${k.dk}" ${k.S}/><polygon points="68,48 75,36 78,50" fill="${k.dk}" ${k.S}/>
      <rect x="30" y="72" width="11" height="18" rx="4" fill="${k.dk}" ${k.S}/><rect x="70" y="72" width="11" height="18" rx="4" fill="${k.dk}" ${k.S}/>
      <rect x="44" y="74" width="10" height="16" rx="4" fill="${k.dk}" ${k.S}/><rect x="80" y="70" width="10" height="18" rx="4" fill="${k.dk}" ${k.S}/>
      <ellipse cx="58" cy="62" rx="34" ry="20" fill="${body}" ${k.S}/>
      <path d="M36 52 Q58 40 86 54 M34 66 Q58 56 90 66" fill="none" stroke="#d4ac0d" stroke-width="2.4"/>
      <path d="M44 50 Q46 62 42 74 M62 46 Q64 60 60 78" fill="none" stroke="${k.lt}" stroke-width="2" opacity="0.6"/>
      <ellipse cx="24" cy="60" rx="17" ry="14" fill="${body}" ${k.S}/>
      <polygon points="14,54 2,20 22,46" fill="${k.lin('h', [[0, '#fffbe8'], [1, '#c9b48a']])}" ${k.S}/>
      <polygon points="24,48 22,34 30,46" fill="#e8dcc0" ${k.S}/>
      <polygon points="30,48 36,40 36,52" fill="${k.dk}" ${k.S}/>
      <path d="M10 66 Q16 70 22 67" fill="none" stroke="${k.ln}" stroke-width="2"/>
      ${eye(26, 56, 3.4, k.ln, { glow: '#ff9f43', fierce: 'l' })}`;
  },
  bogulith: (k) => {
    const stone = k.shade('b');
    return `
      <ellipse cx="50" cy="88" rx="40" ry="8" fill="#4a3518" ${k.S}/>
      <path d="M14 86 Q6 76 12 66 M86 86 Q96 74 88 64" fill="none" stroke="#5a4320" stroke-width="5" stroke-linecap="round"/>
      <polygon points="14,48 20,40 26,48 20,56" fill="${stone}" ${k.S}/><polygon points="80,44 86,36 92,44 86,52" fill="${stone}" ${k.S}/>
      <circle cx="20" cy="48" r="9" fill="${k.glow('o', '#b6ff6a')}"/><circle cx="86" cy="44" r="9" fill="${k.glow('o2', '#b6ff6a')}"/>
      <polygon points="30,88 32,22 50,8 68,22 70,88" fill="${stone}" ${k.S}/>
      <path d="M50 8 L50 30 M38 70 L46 78 M62 64 L58 74" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <ellipse cx="44" cy="20" rx="9" ry="4" fill="#7fb069" opacity="0.9"/><ellipse cx="60" cy="26" rx="6" ry="3" fill="#7fb069" opacity="0.9"/>
      <path d="M38 62 l4 -6 4 6 4 -6 4 6 4 -6 4 6" fill="none" stroke="#b6ff6a" stroke-width="2.2"/>
      <path d="M42 74 h16 M50 68 v12" stroke="#b6ff6a" stroke-width="2"/>
      ${eye(50, 42, 8, k.ln, { iris: '#7fff4f', fierce: 'l' })}`;
  },
  abyssion: (k) => {
    const path = 'M14 90 Q4 66 30 64 Q58 62 60 46 Q62 30 44 26';
    const dots = [[22, 70], [36, 64], [50, 60], [58, 50], [58, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#7ff6ff"/>`).join('');
    return `
      <circle cx="80" cy="30" r="3" fill="none" stroke="#bfeaf0" stroke-width="1.5"/><circle cx="86" cy="18" r="2" fill="none" stroke="#bfeaf0" stroke-width="1.3"/>
      <path d="${path}" fill="none" stroke="${k.ln}" stroke-width="22" stroke-linecap="round"/>
      <path d="${path}" fill="none" stroke="${k.c}" stroke-width="17" stroke-linecap="round"/>
      <path d="${path}" fill="none" stroke="${k.lt}" stroke-width="3" stroke-dasharray="2 10" opacity="0.8"/>
      ${dots}
      <polygon points="16,74 6,60 22,66" fill="${k.lt}" ${k.S}/><polygon points="62,52 76,44 66,58" fill="${k.lt}" ${k.S}/>
      <polygon points="30,18 36,2 42,16" fill="${k.lt}" ${k.S}/><polygon points="40,14 48,0 52,16" fill="${k.lt}" ${k.S}/>
      <path d="M22 26 Q30 10 50 16 Q62 22 58 32 L40 36 Q26 36 22 26 Z" fill="${k.shade('h')}" ${k.S}/>
      <path d="M24 32 Q34 44 50 34 L40 36 Z" fill="#0b1a33" ${k.S}/>
      <polygon points="30,34 32,38 34,34" fill="#fff"/><polygon points="38,35 40,39 42,35" fill="#fff"/>
      ${eye(34, 23, 3.6, k.ln, { glow: '#7ff6ff', fierce: 'l' })}${eye(46, 21, 3.6, k.ln, { glow: '#7ff6ff', fierce: 'r' })}`;
  },
  tempestray: (k) => {
    const wing = k.lin('w', [[0, shade(k.c, 0.4)], [0.6, k.c], [1, shade(k.c, -0.45)]]);
    return `
      <g opacity="0.55"><circle cx="20" cy="22" r="10" fill="#8a97a6"/><circle cx="32" cy="16" r="12" fill="#9aa6b4"/><circle cx="74" cy="18" r="11" fill="#8a97a6"/><circle cx="84" cy="24" r="8" fill="#7d8a99"/></g>
      <path d="M50 76 Q54 88 70 96" fill="none" stroke="${k.ln}" stroke-width="3"/>
      ${bolt(72, 94, 0.45, '#fff27a', k.ln, 40)}
      <path d="M50 30 Q20 30 4 54 Q22 58 40 66 L50 78 L60 66 Q78 58 96 54 Q80 30 50 30 Z" fill="${wing}" ${k.S}/>
      <path d="M6 54 l8 -3 -2 4 8 -2 M94 54 l-8 -3 2 4 -8 -2" fill="none" stroke="#fff27a" stroke-width="2"/>
      <path d="M30 46 Q50 40 70 46" fill="none" stroke="${k.lt}" stroke-width="2" opacity="0.7"/>
      <path d="M40 32 Q34 20 40 16 M60 32 Q66 20 60 16" fill="none" stroke="${k.ln}" stroke-width="4" stroke-linecap="round"/>
      <path d="M40 32 Q34 20 40 16 M60 32 Q66 20 60 16" fill="none" stroke="${k.c}" stroke-width="2" stroke-linecap="round"/>
      <path d="M40 58 Q50 64 60 58" fill="none" stroke="${k.lt}" stroke-width="2"/>
      ${eye(42, 40, 3.6, k.ln, { glow: '#fff27a', fierce: 'l' })}${eye(58, 40, 3.6, k.ln, { glow: '#fff27a', fierce: 'r' })}`;
  },
  // ============================================================ ★4 species (fusion only)
  voltaron: (k) => {
    const body = k.shade('b');
    const wing = k.lin('w', [[0, '#fffbe0'], [0.5, k.c], [1, '#7a5a00']]);
    const leftWing = `<path d="M40 50 L2 14 L10 34 L0 40 L10 48 L2 58 L16 60 L38 64 Z" fill="${wing}" ${k.S}/>
      <path d="M6 22 l8 9 -4 2 10 10 M4 46 l10 2" fill="none" stroke="#fff27a" stroke-width="2"/>`;
    return `
      <circle cx="50" cy="50" r="48" fill="${k.glow('g', '#fff27a')}"/>
      <g opacity="0.85"><circle cx="20" cy="10" r="9" fill="#4d5d6c"/><circle cx="80" cy="10" r="9" fill="#4d5d6c"/></g>
      ${bolt(14, 20, 0.6, '#fff27a', '#5d4a00', -15)}${bolt(86, 20, 0.6, '#fff27a', '#5d4a00', 15)}
      ${leftWing}<g transform="translate(100 0) scale(-1 1)">${leftWing}</g>
      <path d="M62 82 l14 -4 -4 6 16 -2" fill="none" stroke="${k.ln}" stroke-width="6" stroke-linecap="round"/>
      <path d="M62 82 l14 -4 -4 6 16 -2" fill="none" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="50" cy="70" rx="19" ry="17" fill="${body}" ${k.S}/>
      <circle cx="50" cy="68" r="9" fill="${k.glow('c', '#ffffff')}"/><circle cx="50" cy="68" r="4" fill="#fffbe0"/>
      <rect x="43" y="40" width="14" height="18" rx="6" fill="${body}" ${k.S}/>
      <circle cx="50" cy="16" r="13" fill="none" stroke="#fff27a" stroke-width="2" stroke-dasharray="3 4"/>
      <polygon points="${spikes(50, 24, 5, 13, 6, -Math.PI / 2)}" fill="#ffd700" ${k.S}/>
      <path d="M38 34 Q28 24 30 12 Q38 24 44 28 Z" fill="#fff8e1" ${k.S}/><path d="M62 34 Q72 24 70 12 Q62 24 56 28 Z" fill="#fff8e1" ${k.S}/>
      <ellipse cx="50" cy="38" rx="15" ry="12" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="45" rx="8" ry="5" fill="${k.lt}"/>
      <polygon points="46,48 47.5,51 49,48" fill="#fff"/><polygon points="51,48 52.5,51 54,48" fill="#fff"/>
      ${eye(44, 35, 3.8, k.ln, { glow: '#7fd8ff', fierce: 'l' })}${eye(56, 35, 3.8, k.ln, { glow: '#7fd8ff', fierce: 'r' })}`;
  },
  colossar: (k) => {
    const metal = k.shade('b');
    return `
      <circle cx="50" cy="56" r="46" fill="${k.glow('g', '#7ff6ff')}"/>
      <rect x="6" y="14" width="12" height="40" rx="3" fill="${k.shade('p1', '#5d6d7e')}" ${k.S}/><rect x="82" y="14" width="12" height="40" rx="3" fill="${k.shade('p2', '#5d6d7e')}" ${k.S}/>
      <circle cx="12" cy="12" r="5" fill="#7ff6ff" ${k.S}/><circle cx="88" cy="12" r="5" fill="#7ff6ff" ${k.S}/>
      <path d="M16 12 l10 4 -4 3 12 3 -4 3 14 1 -4 3 14 -2 -4 -3 12 -2" fill="none" stroke="#bff8ff" stroke-width="2.2"/>
      <rect x="26" y="74" width="16" height="18" rx="4" fill="${k.dk}" ${k.S}/><rect x="58" y="74" width="16" height="18" rx="4" fill="${k.dk}" ${k.S}/>
      <rect x="4" y="50" width="16" height="28" rx="6" fill="${metal}" ${k.S}/><rect x="80" y="50" width="16" height="28" rx="6" fill="${metal}" ${k.S}/>
      <polygon points="18,80 20,40 80,40 82,80" fill="${metal}" ${k.S}/>
      <path d="M20 56 H80 M30 40 V80 M70 40 V80" stroke="${k.ln}" stroke-width="1.4" opacity="0.6"/>
      <circle cx="50" cy="60" r="15" fill="${k.glow('c', '#7ff6ff')}"/>
      <circle cx="50" cy="60" r="10" fill="none" stroke="#7ff6ff" stroke-width="2.5"/><circle cx="50" cy="60" r="5" fill="#e6fdff" ${k.S}/>
      <rect x="36" y="20" width="28" height="22" rx="6" fill="${metal}" ${k.S}/>
      <rect x="39" y="27" width="22" height="7" rx="3.5" fill="#0b1520"/>
      <rect x="41" y="29" width="18" height="3" rx="1.5" fill="#7ff6ff"/>`;
  },
  orogon: (k) => {
    const body = k.shade('b');
    const peak = (x: number, h: number, w: number) => `<polygon points="${x - w},50 ${x},${50 - h} ${x + w},50" fill="${k.shade('pk' + x, '#8d8f99')}" ${k.S}/>
      <polygon points="${x - w * 0.35},${50 - h * 0.65} ${x},${50 - h} ${x + w * 0.35},${50 - h * 0.65}" fill="#f4f8fb"/>`;
    return `
      <circle cx="56" cy="56" r="44" fill="${k.glow('g', '#ff9f43')}"/>
      ${peak(44, 30, 12)}${peak(62, 42, 14)}${peak(80, 26, 11)}
      <rect x="40" y="74" width="12" height="18" rx="4" fill="${k.dk}" ${k.S}/><rect x="74" y="74" width="12" height="18" rx="4" fill="${k.dk}" ${k.S}/>
      <path d="M86 66 Q98 70 96 84" fill="none" stroke="${k.ln}" stroke-width="8" stroke-linecap="round"/>
      <path d="M86 66 Q98 70 96 84" fill="none" stroke="${k.c}" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="62" cy="64" rx="30" ry="18" fill="${body}" ${k.S}/>
      <path d="M44 60 L52 66 L48 72 M66 56 L72 64 L68 70 M80 62 L84 70" fill="none" stroke="#ff7a1a" stroke-width="2.4"/>
      <path d="M36 54 Q30 40 20 38" fill="none" stroke="${k.ln}" stroke-width="12" stroke-linecap="round"/>
      <path d="M36 54 Q30 40 20 38" fill="none" stroke="${k.c}" stroke-width="8" stroke-linecap="round"/>
      <path d="M14 28 Q8 14 18 8 Q16 20 22 26 Z" fill="#e8dcc0" ${k.S}/><path d="M26 26 Q28 12 38 10 Q32 20 30 28 Z" fill="#e8dcc0" ${k.S}/>
      <ellipse cx="20" cy="36" rx="15" ry="11" fill="${body}" ${k.S}/>
      <path d="M6 40 Q14 50 26 42 L18 42 Z" fill="#3a1206" ${k.S}/>
      <ellipse cx="14" cy="43" rx="4" ry="2" fill="#ff7a1a" opacity="0.9"/>
      ${eye(18, 32, 3.6, k.ln, { glow: '#ff9f43', fierce: 'l' })}${eye(27, 31, 3.4, k.ln, { glow: '#ff9f43', fierce: 'r' })}`;
  },
  atlantor: (k) => {
    const armor = k.shade('b');
    const pillar = (x: number) => `<rect x="${x}" y="16" width="12" height="24" fill="#e8e4d8" ${k.S}/><rect x="${x - 2}" y="12" width="16" height="5" fill="#d4ccb4" ${k.S}/>
      <path d="M${x + 3} 18 V38 M${x + 6} 18 V38 M${x + 9} 18 V38" stroke="#b8b09a" stroke-width="1"/>`;
    return `
      <circle cx="50" cy="54" r="46" fill="${k.glow('g', '#7ff6e0')}"/>
      ${pillar(10)}${pillar(78)}
      <path d="M90 14 V92" stroke="${k.ln}" stroke-width="5"/><path d="M90 14 V92" stroke="#e0b84a" stroke-width="2.6"/>
      <path d="M82 22 V10 M90 18 V4 M98 22 V10 M82 22 H98" fill="none" stroke="#e0b84a" stroke-width="3" stroke-linecap="round"/>
      <rect x="28" y="76" width="14" height="16" rx="4" fill="${k.dk}" ${k.S}/><rect x="58" y="76" width="14" height="16" rx="4" fill="${k.dk}" ${k.S}/>
      <polygon points="20,80 24,40 76,40 80,80" fill="${armor}" ${k.S}/>
      <path d="M24 52 H76 M50 40 V80" stroke="#e0b84a" stroke-width="1.8" opacity="0.8"/>
      <circle cx="22" cy="62" r="17" fill="${k.shade('s', '#2a6f8a')}" ${k.S}/>
      <path d="M10 64 Q16 56 22 64 T34 64" fill="none" stroke="#bff8ff" stroke-width="2.4"/>
      <circle cx="22" cy="62" r="17" fill="none" stroke="#e0b84a" stroke-width="2"/>
      <rect x="36" y="16" width="28" height="26" rx="8" fill="${armor}" ${k.S}/>
      <polygon points="44,16 50,2 56,16" fill="#e0b84a" ${k.S}/>
      <rect x="40" y="26" width="20" height="6" rx="3" fill="#0b1a20"/>
      <ellipse cx="45" cy="29" rx="3" ry="1.6" fill="#7ff6ff"/><ellipse cx="55" cy="29" rx="3" ry="1.6" fill="#7ff6ff"/>
      <circle cx="66" cy="70" r="2" fill="#ff9ad5"/><circle cx="70" cy="64" r="1.6" fill="#ffb067"/>`;
  },
  thalassor: (k) => {
    const body = k.shade('b');
    const arch = 'M10 92 Q12 54 40 50 Q66 46 72 30';
    return `
      <circle cx="56" cy="40" r="44" fill="${k.glow('g', '#7ff6ff')}"/>
      <path d="${arch}" fill="none" stroke="${k.ln}" stroke-width="26" stroke-linecap="round"/>
      <path d="${arch}" fill="none" stroke="${k.c}" stroke-width="21" stroke-linecap="round"/>
      <path d="M14 82 Q18 60 40 56" fill="none" stroke="${k.lt}" stroke-width="4" opacity="0.6"/>
      <circle cx="22" cy="72" r="2" fill="#7ff6ff"/><circle cx="32" cy="60" r="2" fill="#7ff6ff"/><circle cx="46" cy="52" r="2" fill="#7ff6ff"/><circle cx="60" cy="46" r="2" fill="#7ff6ff"/>
      <polygon points="30,46 24,30 40,42" fill="${k.lt}" ${k.S}/><polygon points="46,42 44,26 56,38" fill="${k.lt}" ${k.S}/>
      <polygon points="${spikes(74, 14, 6, 13, 6, -Math.PI / 2)}" fill="${k.lin('cr', [[0, '#ffffff'], [1, '#e0b84a']])}" ${k.S}/>
      <path d="M56 30 Q60 12 80 14 Q96 18 94 30 Q90 40 74 40 Q60 40 56 30 Z" fill="${body}" ${k.S}/>
      <path d="M60 36 Q66 46 62 54 M70 40 Q72 50 68 58" fill="none" stroke="${k.lt}" stroke-width="1.6"/>
      ${eye(70, 26, 3.8, k.ln, { glow: '#7ff6ff', fierce: 'l' })}${eye(82, 25, 3.8, k.ln, { glow: '#7ff6ff', fierce: 'r' })}
      <path d="M76 34 Q84 38 90 34" fill="none" stroke="${k.ln}" stroke-width="2"/>
      ${drop(88, 8, 0.7, '#dff4ff', '#3a7ca5')}${drop(58, 14, 0.6, '#dff4ff', '#3a7ca5')}
      <path d="M0 82 Q12 76 24 82 T48 82 T72 82 T100 82 V100 H0 Z" fill="${k.lin('wv', [[0, '#3a8fd0', 0.85], [1, '#0e2f55', 0.95]])}"/>
      <path d="M6 88 Q16 85 26 88 M60 90 Q70 87 80 90" fill="none" stroke="#dff4ff" stroke-width="1.5" opacity="0.7"/>`;
  },
  typhonix: (k) => {
    const wing = k.lin('w', [[0, '#ffffff'], [0.5, k.c], [1, shade(k.c, -0.4)]]);
    const leftWing = `<path d="M44 48 Q20 30 0 34 Q14 40 4 46 Q20 48 8 56 Q24 56 16 64 Q32 60 42 60 Z" fill="${wing}" ${k.S}/>
      <path d="M10 40 l8 4 -3 2 8 4" fill="none" stroke="#fff27a" stroke-width="1.8"/>`;
    return `
      <circle cx="50" cy="50" r="48" fill="${k.glow('g', '#bff8ff')}"/>
      <path d="M50 50 m-34 0 a34 34 0 1 1 34 34 a26 26 0 1 1 -26 -26 a18 18 0 1 1 18 18" fill="none" stroke="#dffcff" stroke-width="2.5" opacity="0.45"/>
      ${leftWing}<g transform="translate(100 0) scale(-1 1)">${leftWing}</g>
      <path d="M46 74 Q36 90 46 98 M50 76 Q50 92 56 98 M54 74 Q66 88 62 98" fill="none" stroke="${k.ln}" stroke-width="5" stroke-linecap="round"/>
      <path d="M46 74 Q36 90 46 98 M50 76 Q50 92 56 98 M54 74 Q66 88 62 98" fill="none" stroke="${k.lt}" stroke-width="2.5" stroke-linecap="round"/>
      <ellipse cx="50" cy="60" rx="12" ry="18" fill="${k.shade('b')}" ${k.S}/>
      <path d="M44 56 Q50 60 56 56 M45 64 Q50 67 55 64" fill="none" stroke="${k.lt}" stroke-width="1.6"/>
      <path d="M44 28 Q40 12 48 4 Q48 16 52 22 Q56 10 64 8 Q58 20 56 30 Z" fill="${wing}" ${k.S}/>
      <circle cx="50" cy="36" r="12" fill="${k.shade('h')}" ${k.S}/>
      <polygon points="46,40 54,40 50,48" fill="#f5b041" ${k.S}/>
      ${eye(45, 34, 3.4, k.ln, { glow: '#fff27a', fierce: 'l' })}${eye(55, 34, 3.4, k.ln, { glow: '#fff27a', fierce: 'r' })}`;
  },
  // ============================================================ wild species
  // ------------------------------------------------------------ Sparkit -> Thunderhawk, Voltcoil
  sparkit: (k) => {
    const body = k.shade('b');
    return `
      <path d="M16 40 l5 3 -3 2 5 3" fill="none" stroke="#fff27a" stroke-width="2"/><path d="M84 36 l-5 3 3 2 -5 3" fill="none" stroke="#fff27a" stroke-width="2"/>
      <path d="M44 86 v6 M40 92 h8 M56 86 v6 M52 92 h8" stroke="#ff9f1a" stroke-width="2.4"/>
      <ellipse cx="25" cy="62" rx="7" ry="12" transform="rotate(25 25 62)" fill="${k.dk}" ${k.S}/>
      <ellipse cx="75" cy="62" rx="7" ry="12" transform="rotate(-25 75 62)" fill="${k.dk}" ${k.S}/>
      <circle cx="50" cy="60" r="25" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="70" rx="14" ry="11" fill="${k.lt}"/>
      <polygon points="40,40 44,18 50,32 56,14 60,40" fill="${k.lin('c', [[0, '#fffbe0'], [1, '#ffb300']])}" ${k.S}/>
      ${bolt(50, 26, 0.55, '#fff27a', k.ln)}
      ${eye(41, 54, 5.5, k.ln, { iris: '#3a2a10' })}${eye(59, 54, 5.5, k.ln, { iris: '#3a2a10' })}
      <ellipse cx="35" cy="63" rx="4" ry="2.4" fill="#ff8a3d" opacity="0.7"/><ellipse cx="65" cy="63" rx="4" ry="2.4" fill="#ff8a3d" opacity="0.7"/>
      <polygon points="45,62 55,62 50,70" fill="#ff9f1a" ${k.S}/>`;
  },
  thunderhawk: (k) => {
    const body = k.shade('b');
    const wing = k.lin('w', [[0, '#fff3b0'], [0.6, k.c], [1, shade(k.c, -0.35)]]);
    const leftWing = `<path d="M42 52 L4 24 L10 38 L2 44 L12 52 L4 60 L18 62 L40 66 Z" fill="${wing}" ${k.S}/>
      <path d="M10 34 l8 6 -4 2 10 8" fill="none" stroke="#fff27a" stroke-width="2"/>`;
    return `
      <circle cx="50" cy="50" r="40" fill="${k.glow('g', '#fff27a')}"/>
      ${leftWing}<g transform="translate(100 0) scale(-1 1)">${leftWing}</g>
      <polygon points="42,76 50,96 58,76" fill="${k.dk}" ${k.S}/><polygon points="36,74 40,92 48,78" fill="${k.dk}" ${k.S}/><polygon points="64,74 60,92 52,78" fill="${k.dk}" ${k.S}/>
      <ellipse cx="50" cy="62" rx="15" ry="19" fill="${body}" ${k.S}/>
      <path d="M44 56 Q50 60 56 56 M44 64 Q50 68 56 64 M45 72 Q50 75 55 72" fill="none" stroke="${k.lt}" stroke-width="2"/>
      <polygon points="42,28 38,10 47,22 50,6 53,22 62,10 58,28" fill="#fff27a" ${k.S}/>
      <circle cx="50" cy="36" r="13" fill="${body}" ${k.S}/>
      <path d="M45 40 L55 40 L53 49 L50 46 Z" fill="#ff9f1a" ${k.S}/>
      ${eye(44, 34, 3.8, k.ln, { iris: '#1e8bc3', fierce: 'l' })}${eye(56, 34, 3.8, k.ln, { iris: '#1e8bc3', fierce: 'r' })}`;
  },
  voltcoil: (k) => {
    const path = 'M18 88 Q8 62 34 60 Q62 58 64 42 Q66 26 46 26';
    return `
      <path d="${path}" fill="none" stroke="${k.ln}" stroke-width="20" stroke-linecap="round"/>
      <path d="${path}" fill="none" stroke="${k.c}" stroke-width="15" stroke-linecap="round"/>
      <path d="${path}" fill="none" stroke="#fff27a" stroke-width="3" stroke-dasharray="6 7"/>
      <polygon points="58,58 72,66 62,70" fill="${k.lt}" ${k.S}/><polygon points="14,74 2,70 10,82" fill="${k.lt}" ${k.S}/>
      <polygon points="40,16 46,4 52,18" fill="#fff27a" ${k.S}/><polygon points="30,20 30,8 38,18" fill="#fff27a" ${k.S}/>
      <ellipse cx="40" cy="27" rx="16" ry="11" transform="rotate(-12 40 27)" fill="${k.shade('h')}" ${k.S}/>
      <path d="M26 32 Q34 36 42 33" fill="none" stroke="${k.ln}" stroke-width="1.8"/>
      ${eye(36, 23, 3.6, k.ln, { glow: '#fff27a', fierce: 'l' })}${eye(46, 22, 3.6, k.ln, { glow: '#fff27a', fierce: 'r' })}
      <path d="M74 30 l6 4 -3 2 6 4 M80 78 l6 -4 -2 4 6 -2" fill="none" stroke="#fff27a" stroke-width="2"/>`;
  },
  // ------------------------------------------------------------ Shelloch -> Fortoise, Geckrag, Flintfang
  shelloch: (k) => {
    const shell = k.shade('s');
    const skin = '#b9c98f';
    return `
      <ellipse cx="26" cy="80" rx="8" ry="6" fill="${skin}" ${k.S}/><ellipse cx="74" cy="80" rx="8" ry="6" fill="${skin}" ${k.S}/>
      <path d="M18 70 Q18 34 50 32 Q82 34 82 70 Z" fill="${shell}" ${k.S}/>
      <path d="M36 40 L44 50 L56 50 L64 40 M44 50 L40 64 M56 50 L60 64 M30 56 L40 64 L60 64 L70 56" fill="none" stroke="${k.lt}" stroke-width="2" opacity="0.8"/>
      <ellipse cx="38" cy="40" rx="8" ry="3" fill="#7fb069" opacity="0.8"/>
      <rect x="16" y="66" width="68" height="8" rx="4" fill="${k.dk}" ${k.S}/>
      <ellipse cx="50" cy="80" rx="14" ry="10" fill="${skin}" ${k.S}/>
      ${eye(44, 78, 3.8, k.ln, { iris: '#2e3a1a' })}${eye(56, 78, 3.8, k.ln, { iris: '#2e3a1a' })}
      <path d="M46 85 Q50 87 54 85" fill="none" stroke="${k.ln}" stroke-width="1.6"/>`;
  },
  fortoise: (k) => {
    const shell = k.shade('s');
    const skin = '#9aab6f';
    const tower = (x: number) => `<rect x="${x}" y="14" width="14" height="22" fill="${k.shade('t' + x, '#9a9a8a')}" ${k.S}/>
      <path d="M${x} 14 v-5 h4 v5 h3 v-5 h4 v5 h3 v-5" fill="#8a8a7a" ${k.S}/><rect x="${x + 5}" y="22" width="4" height="6" rx="2" fill="#2b2b2b"/>`;
    return `
      <rect x="12" y="74" width="16" height="16" rx="6" fill="${skin}" ${k.S}/><rect x="72" y="74" width="16" height="16" rx="6" fill="${skin}" ${k.S}/>
      ${tower(24)}${tower(62)}
      <path d="M38 18 V6 L50 10 L38 14" fill="#e74c3c" stroke="${k.ln}" stroke-width="1.5"/>
      <rect x="36" y="22" width="28" height="14" fill="#8a8a7a" ${k.S}/>
      <path d="M8 74 Q8 32 50 30 Q92 32 92 74 Z" fill="${shell}" ${k.S}/>
      <path d="M30 42 L40 52 L60 52 L70 42 M40 52 L34 68 M60 52 L66 68" fill="none" stroke="${k.lt}" stroke-width="2.2" opacity="0.8"/>
      <rect x="8" y="70" width="84" height="9" rx="4" fill="${k.dk}" ${k.S}/>
      <ellipse cx="50" cy="84" rx="15" ry="10" fill="${skin}" ${k.S}/>
      ${eye(43, 82, 3.6, k.ln, { iris: '#3a2a10', fierce: 'l' })}${eye(57, 82, 3.6, k.ln, { iris: '#3a2a10', fierce: 'r' })}
      <path d="M44 89 L56 89" stroke="${k.ln}" stroke-width="2"/>`;
  },
  geckrag: (k) => {
    const body = k.shade('b');
    const gem = (x: number, y: number, c: string) => `<polygon points="${x},${y - 4} ${x + 3},${y} ${x},${y + 4} ${x - 3},${y}" fill="${c}" stroke="${k.ln}" stroke-width="1"/>`;
    return `
      <path d="M64 74 Q92 78 88 58 Q84 44 72 52 Q66 58 76 62" fill="none" stroke="${k.ln}" stroke-width="10" stroke-linecap="round"/>
      <path d="M64 74 Q92 78 88 58 Q84 44 72 52 Q66 58 76 62" fill="none" stroke="${k.c}" stroke-width="6" stroke-linecap="round"/>
      <path d="M30 70 L18 80 M28 74 L20 88 M62 72 L70 84 M58 76 L60 90" stroke="${k.ln}" stroke-width="6" stroke-linecap="round"/>
      <path d="M30 70 L18 80 M28 74 L20 88 M62 72 L70 84 M58 76 L60 90" stroke="${k.c}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="17" cy="81" r="3" fill="${k.lt}"/><circle cx="19" cy="89" r="3" fill="${k.lt}"/><circle cx="71" cy="85" r="3" fill="${k.lt}"/><circle cx="60" cy="91" r="3" fill="${k.lt}"/>
      <ellipse cx="48" cy="66" rx="24" ry="13" transform="rotate(-8 48 66)" fill="${body}" ${k.S}/>
      ${gem(42, 60, '#7fe3ff')}${gem(52, 58, '#ff8ad8')}${gem(60, 61, '#7fe3ff')}${gem(48, 66, '#ffe66d')}
      <ellipse cx="32" cy="46" rx="16" ry="12" fill="${body}" ${k.S}/>
      ${eye(26, 41, 6, k.ln, { iris: '#c0392b' })}${eye(39, 39, 6, k.ln, { iris: '#c0392b' })}
      <path d="M20 52 Q28 57 38 52" fill="none" stroke="${k.ln}" stroke-width="1.8"/>`;
  },
  flintfang: (k) => {
    const body = k.shade('b');
    const flint = k.lin('f', [[0, '#d5d8dc'], [1, '#4a4a5a']], false);
    return `
      <polygon points="74,60 96,44 90,58 98,62 88,68 94,78 76,70" fill="${flint}" ${k.S}/>
      <rect x="38" y="72" width="8" height="18" rx="3" fill="${k.dk}" ${k.S}/><rect x="64" y="72" width="8" height="18" rx="3" fill="${k.dk}" ${k.S}/>
      <ellipse cx="56" cy="66" rx="24" ry="14" fill="${body}" ${k.S}/>
      <polygon points="30,62 26,44 34,52 36,34 42,48 48,32 50,50 58,40 56,58 44,66" fill="${flint}" ${k.S}/>
      <polygon points="26,34 28,18 36,30" fill="${body}" ${k.S}/><polygon points="40,30 46,16 48,32" fill="${body}" ${k.S}/>
      <ellipse cx="36" cy="44" rx="15" ry="12" fill="${body}" ${k.S}/>
      <ellipse cx="24" cy="51" rx="10" ry="6" fill="${k.lt}" ${k.S}/>
      <circle cx="16" cy="49" r="2.6" fill="#1a1a1a"/>
      <polygon points="20,55 22,61 24,55" fill="#fff"/><polygon points="27,56 29,62 31,56" fill="#fff"/>
      ${eye(31, 40, 3.8, k.ln, { glow: '#ffb347', fierce: 'l' })}${eye(43, 40, 3.8, k.ln, { glow: '#ffb347', fierce: 'r' })}`;
  },
  // ------------------------------------------------------------ Bubbloon -> Medusurge, Slushpup, Corallord
  bubbloon: (k) => {
    const bell = k.lin('b', [[0, '#ffffff', 0.95], [0.5, k.c, 0.9], [1, shade(k.c, -0.25), 0.9]]);
    const t = (x: number, d: number) => `<path d="M${x} 52 q${d} 10 0 18 q${-d} 10 0 18" fill="none" stroke="${k.dk}" stroke-width="3" stroke-linecap="round" opacity="0.85"/>`;
    return `
      <circle cx="50" cy="44" r="34" fill="${k.glow('g', '#bff0ff')}"/>
      ${t(34, 5)}${t(42, -5)}${t(50, 5)}${t(58, -5)}${t(66, 5)}
      <path d="M24 54 Q22 18 50 18 Q78 18 76 54 Q64 49 50 53 Q36 49 24 54 Z" fill="${bell}" ${k.S}/>
      <ellipse cx="40" cy="30" rx="8" ry="5" fill="#fff" opacity="0.7"/>
      <circle cx="80" cy="22" r="4" fill="none" stroke="#dff6ff" stroke-width="1.8"/><circle cx="18" cy="30" r="3" fill="none" stroke="#dff6ff" stroke-width="1.6"/>
      <circle cx="84" cy="40" r="2" fill="none" stroke="#dff6ff" stroke-width="1.4"/>
      ${eye(42, 40, 4.5, k.ln, { iris: '#1b4f72' })}${eye(58, 40, 4.5, k.ln, { iris: '#1b4f72' })}
      <path d="M46 47 Q50 50 54 47" fill="none" stroke="${k.ln}" stroke-width="1.6"/>`;
  },
  medusurge: (k) => {
    const bell = k.lin('b', [[0, '#e8dcff', 0.95], [0.5, k.c, 0.92], [1, shade(k.c, -0.4), 0.95]]);
    const t = (x: number, d: number, len: number) => `<path d="M${x} 54 q${d} ${len / 3} 0 ${len * 0.66} q${-d} ${len / 3} ${d * 0.5} ${len * 0.9}" fill="none" stroke="${shade(k.c, 0.35)}" stroke-width="2.6" stroke-linecap="round"/>`;
    return `
      <circle cx="50" cy="46" r="46" fill="${k.glow('g', '#b8a6ff')}"/>
      ${t(28, 6, 40)}${t(36, -6, 44)}${t(44, 6, 46)}${t(56, -6, 46)}${t(64, 6, 44)}${t(72, -6, 40)}
      <path d="M40 54 Q30 74 42 92 Q48 76 46 56 Z" fill="${k.lt}" opacity="0.8" ${k.S}/><path d="M60 54 Q70 74 58 92 Q52 76 54 56 Z" fill="${k.lt}" opacity="0.8" ${k.S}/>
      <path d="M16 56 Q14 14 50 12 Q86 14 84 56 Q72 50 62 56 Q50 50 38 56 Q28 50 16 56 Z" fill="${bell}" ${k.S}/>
      <polygon points="34,16 38,4 42,14 50,0 58,14 62,4 66,16" fill="${k.lin('c', [[0, '#ffffff'], [1, '#d0b8ff']])}" ${k.S}/>
      <circle cx="30" cy="40" r="3" fill="#7ff6ff"/><circle cx="70" cy="40" r="3" fill="#7ff6ff"/><circle cx="50" cy="26" r="3" fill="#7ff6ff"/>
      <circle cx="24" cy="50" r="2" fill="#7ff6ff"/><circle cx="76" cy="50" r="2" fill="#7ff6ff"/>
      ${eye(42, 40, 4.2, k.ln, { glow: '#7ff6ff', fierce: 'l' })}${eye(58, 40, 4.2, k.ln, { glow: '#7ff6ff', fierce: 'r' })}`;
  },
  slushpup: (k) => {
    const body = k.shade('b');
    return `
      ${sparkle(84, 24, 4, '#e6f7ff')}${sparkle(14, 30, 3, '#e6f7ff')}${sparkle(76, 12, 2.5, '#ffffff')}
      <path d="M78 70 L96 60 L92 74 L98 86 Z" fill="${k.dk}" ${k.S}/>
      <path d="M16 78 Q12 52 38 46 Q66 42 80 62 Q88 78 74 84 Q48 92 16 78 Z" fill="${body}" ${k.S}/>
      <ellipse cx="48" cy="74" rx="18" ry="9" fill="#ffffff" opacity="0.7"/>
      <ellipse cx="30" cy="82" rx="10" ry="5" transform="rotate(-20 30 82)" fill="${k.dk}" ${k.S}/>
      <circle cx="36" cy="44" r="18" fill="${body}" ${k.S}/>
      <ellipse cx="30" cy="53" rx="10" ry="7" fill="#ffffff" ${k.S}/>
      <ellipse cx="30" cy="49" rx="3.5" ry="2.5" fill="#1a1a1a"/>
      <path d="M22 53 L10 50 M22 56 L10 58 M38 53 L48 50 M38 56 L48 58" stroke="${k.ln}" stroke-width="1"/>
      ${eye(28, 40, 5.5, k.ln, { iris: '#1a1a1a' })}${eye(44, 39, 5.5, k.ln, { iris: '#1a1a1a' })}
      <ellipse cx="22" cy="47" rx="3" ry="2" fill="#ffb3c1" opacity="0.7"/><ellipse cx="50" cy="46" rx="3" ry="2" fill="#ffb3c1" opacity="0.7"/>`;
  },
  corallord: (k) => {
    const rock = k.shade('r', '#3a7d7a');
    const branch = (d: string, c: string) => `<path d="${d}" fill="none" stroke="${k.ln}" stroke-width="9" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/>`;
    return `
      ${branch('M32 50 Q24 34 28 20 M28 30 Q18 26 14 16 M28 24 Q36 16 34 8', k.c)}
      ${branch('M68 50 Q78 36 72 22 M74 32 Q84 26 88 16 M72 26 Q64 18 68 8', '#ffb067')}
      ${branch('M50 46 Q50 30 46 20 M48 32 Q56 26 58 16', '#ff9ad5')}
      <ellipse cx="80" cy="44" rx="5" ry="3" fill="#ffb347" stroke="${k.ln}" stroke-width="1"/><polygon points="84,44 89,41 89,47" fill="#ffb347"/>
      <rect x="20" y="76" width="16" height="16" rx="6" fill="${rock}" ${k.S}/><rect x="64" y="76" width="16" height="16" rx="6" fill="${rock}" ${k.S}/>
      <path d="M22 84 Q18 50 50 44 Q82 50 78 84 Z" fill="${rock}" ${k.S}/>
      <circle cx="30" cy="62" r="3" fill="${k.c}"/><circle cx="70" cy="70" r="4" fill="#ffb067"/><circle cx="62" cy="56" r="2.5" fill="#ff9ad5"/>
      <circle cx="50" cy="70" r="10" fill="${k.glow('c', '#7ff6ff')}"/><circle cx="50" cy="70" r="4" fill="#dffcff"/>
      ${eye(42, 56, 4, k.ln, { glow: '#7ff6ff', fierce: 'l' })}${eye(58, 56, 4, k.ln, { glow: '#7ff6ff', fierce: 'r' })}`;
  },
  // ------------------------------------------------------------ Spark line: Zapling -> Voltail
  zapling: (k) => {
    const body = k.shade('b');
    return `
      <path d="M8 34 l5 4 -3 2 6 4" fill="none" stroke="#fff27a" stroke-width="2"/>
      <path d="M86 18 l-4 4 3 1 -5 5" fill="none" stroke="#fff27a" stroke-width="2"/>
      <polygon points="60,72 84,60 76,54 95,36 72,45 80,30 58,50 67,56" fill="${k.lin('t', [[0, '#fffbe0'], [1, '#ffd23f']])}" ${k.S}/>
      <ellipse cx="50" cy="68" rx="22" ry="18" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="73" rx="13" ry="10" fill="${k.lt}"/>
      <ellipse cx="38" cy="85" rx="6" ry="4" fill="${k.dk}" ${k.S}/><ellipse cx="62" cy="85" rx="6" ry="4" fill="${k.dk}" ${k.S}/>
      <polygon points="31,42 27,10 47,31" fill="${body}" ${k.S}/><polygon points="69,42 73,10 53,31" fill="${body}" ${k.S}/>
      <polygon points="29,22 27,10 35,18" fill="#3b2f2f"/><polygon points="71,22 73,10 65,18" fill="#3b2f2f"/>
      <circle cx="50" cy="44" r="20" fill="${body}" ${k.S}/>
      <ellipse cx="44" cy="35" rx="7" ry="4" fill="#fff" opacity="0.35"/>
      <circle cx="35" cy="51" r="4.5" fill="#ff8a3d"/><circle cx="65" cy="51" r="4.5" fill="#ff8a3d"/>
      ${eye(42, 43, 5.5, k.ln, { iris: '#2e2a24' })}${eye(58, 43, 5.5, k.ln, { iris: '#2e2a24' })}
      <path d="M48 51 L52 51 L50 53 Z" fill="${k.ln}"/>
      <path d="M45 55 Q47.5 57.5 50 55 Q52.5 57.5 55 55" fill="none" stroke="${k.ln}" stroke-width="1.6"/>`;
  },
  voltail: (k) => {
    const body = k.shade('b');
    const tail = k.lin('t', [[0, '#ffffff'], [0.4, '#fff27a'], [1, '#ffb300']]);
    const t = (rot: number) => `<polygon transform="rotate(${rot} 62 66)" points="60,70 82,56 74,50 96,30 72,42 82,24 58,48 66,54" fill="${tail}" ${k.S}/>`;
    return `
      <circle cx="74" cy="44" r="26" fill="${k.glow('g', '#fff27a')}"/>
      <g transform="translate(100 0) scale(-1 1)">${t(-10)}</g>${t(-30)}${t(6)}
      <rect x="32" y="74" width="8" height="14" rx="3" fill="${k.dk}" ${k.S}/><rect x="58" y="74" width="8" height="14" rx="3" fill="${k.dk}" ${k.S}/>
      <ellipse cx="50" cy="66" rx="24" ry="16" fill="${body}" ${k.S}/>
      <polygon points="30,56 34,46 39,54 43,43 48,53 52,42 56,53 61,43 65,54 70,46 72,58 50,64 28,58" fill="#fff8e1" ${k.S}/>
      <polygon points="32,36 26,4 46,26" fill="${body}" ${k.S}/><polygon points="68,36 74,4 54,26" fill="${body}" ${k.S}/>
      <path d="M27 8 Q50 -4 73 8" fill="none" stroke="#fff27a" stroke-width="2" stroke-dasharray="3 3"/>
      <path d="M50 22 Q30 22 31 40 Q33 52 50 54 Q67 52 69 40 Q70 22 50 22 Z" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="47" rx="9" ry="6" fill="${k.lt}"/>
      ${bolt(35, 45, 0.45, '#fff27a', k.ln, 20)}${bolt(65, 45, 0.45, '#fff27a', k.ln, -20)}
      ${eye(43, 37, 5, k.ln, { iris: '#1e8bc3', fierce: 'l' })}${eye(57, 37, 5, k.ln, { iris: '#1e8bc3', fierce: 'r' })}
      <path d="M48 46 L52 46 L50 48.5 Z" fill="${k.ln}"/>
      <path d="M45 50 Q50 53 55 50" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <polygon points="46,50 47.5,53 49,50" fill="#fff"/>`;
  },
  // ------------------------------------------------------------ Stone line: Pebblit -> Bouldurr
  pebblit: (k) => {
    const body = k.shade('b');
    return `
      <ellipse cx="37" cy="84" rx="7" ry="4" fill="${k.dk}" ${k.S}/><ellipse cx="63" cy="84" rx="7" ry="4" fill="${k.dk}" ${k.S}/>
      <path d="M22 72 Q16 46 38 34 Q60 25 76 42 Q88 60 76 76 Q52 88 22 72 Z" fill="${body}" ${k.S}/>
      <path d="M30 46 Q44 34 62 38" fill="none" stroke="${k.lt}" stroke-width="3" opacity="0.8"/>
      <path d="M70 52 L64 58 L68 64" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <path d="M26 62 L32 64" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <ellipse cx="34" cy="70" rx="6" ry="3" fill="#7fb069" opacity="0.8"/>
      <path d="M52 34 Q50 24 54 16" fill="none" stroke="#4e8a3e" stroke-width="2.4"/>
      <ellipse cx="47" cy="20" rx="6" ry="3" transform="rotate(-25 47 20)" fill="#7fc95a" stroke="#3b6b2d" stroke-width="1.5"/>
      <ellipse cx="59" cy="16" rx="6" ry="3" transform="rotate(20 59 16)" fill="#7fc95a" stroke="#3b6b2d" stroke-width="1.5"/>
      ${eye(41, 56, 5.5, k.ln, { iris: '#3a2a1a' })}${eye(60, 56, 5.5, k.ln, { iris: '#3a2a1a' })}
      <ellipse cx="34" cy="64" rx="4" ry="2.4" fill="#ff9aa2" opacity="0.6"/><ellipse cx="67" cy="64" rx="4" ry="2.4" fill="#ff9aa2" opacity="0.6"/>
      <path d="M46 66 Q50 69 54 66" fill="none" stroke="${k.ln}" stroke-width="1.8"/>`;
  },
  bouldurr: (k) => {
    const body = k.shade('b');
    return `
      <polygon points="12,64 18,38 27,52 33,26 43,46 51,20 59,44 69,26 75,48 86,36 90,64" fill="${k.dk}" ${k.S}/>
      <polygon points="64,34 68,22 72,34" fill="#7fe3ff" stroke="${k.ln}" stroke-width="1.5"/><polygon points="70,38 76,28 78,40" fill="#b0f0ff" stroke="${k.ln}" stroke-width="1.5"/>
      <path d="M8 88 Q6 52 32 44 Q50 38 70 44 Q94 52 92 88 Z" fill="${body}" ${k.S}/>
      <ellipse cx="30" cy="50" rx="12" ry="5" fill="#6b9a4a" opacity="0.85"/><ellipse cx="74" cy="54" rx="8" ry="4" fill="#6b9a4a" opacity="0.85"/>
      <rect x="4" y="62" width="16" height="24" rx="7" fill="${k.dk}" ${k.S}/><rect x="80" y="62" width="16" height="24" rx="7" fill="${k.dk}" ${k.S}/>
      <path d="M30 58 Q50 50 70 58" fill="none" stroke="${k.ln}" stroke-width="5" stroke-linecap="round"/>
      ${eye(40, 63, 4.5, k.ln, { iris: '#e67e22', fierce: 'l' })}${eye(60, 63, 4.5, k.ln, { iris: '#e67e22', fierce: 'r' })}
      <path d="M34 74 Q50 84 66 74 L64 80 Q50 88 36 80 Z" fill="#2b1d14" ${k.S}/>
      <polygon points="38,78 41,71 44,78" fill="#fff"/><polygon points="56,78 59,71 62,78" fill="#fff"/>
      <path d="M22 70 L28 76 L24 82" fill="none" stroke="${k.ln}" stroke-width="1.6"/>`;
  },
  // ------------------------------------------------------------ Tide line: Drizzlet -> Torrentoad
  drizzlet: (k) => {
    const body = k.shade('b');
    return `
      <g opacity="0.95"><circle cx="38" cy="14" r="7" fill="#eef6fb" stroke="#9fb6c8" stroke-width="1.5"/><circle cx="50" cy="10" r="9" fill="#ffffff" stroke="#9fb6c8" stroke-width="1.5"/>
      <circle cx="62" cy="14" r="7" fill="#eef6fb" stroke="#9fb6c8" stroke-width="1.5"/><rect x="36" y="13" width="28" height="8" rx="4" fill="#f4f9fc"/></g>
      ${drop(40, 28, 0.7, '#aee3ff', '#3a7ca5')}${drop(52, 31, 0.8, '#aee3ff', '#3a7ca5')}${drop(62, 27, 0.6, '#aee3ff', '#3a7ca5')}
      <path d="M70 70 Q94 58 92 82 Q80 80 70 77 Z" fill="${k.lt}" ${k.S}/>
      <ellipse cx="50" cy="69" rx="26" ry="18" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="75" rx="16" ry="9" fill="${k.lt}"/>
      <circle cx="35" cy="48" r="11" fill="${body}" ${k.S}/><circle cx="65" cy="48" r="11" fill="${body}" ${k.S}/>
      ${eye(35, 48, 7, k.ln, { iris: '#1b4f72' })}${eye(65, 48, 7, k.ln, { iris: '#1b4f72' })}
      <ellipse cx="32" cy="64" rx="4" ry="2.4" fill="#ff9aa2" opacity="0.55"/><ellipse cx="68" cy="64" rx="4" ry="2.4" fill="#ff9aa2" opacity="0.55"/>
      <path d="M38 64 Q50 73 62 64" fill="none" stroke="${k.ln}" stroke-width="2"/>`;
  },
  torrentoad: (k) => {
    const body = k.shade('b');
    const shell = k.shade('s', shade(k.c, -0.3));
    return `
      <path d="M28 44 Q22 22 32 6" fill="none" stroke="#aee3ff" stroke-width="6" stroke-linecap="round"/>
      <path d="M72 44 Q78 22 68 6" fill="none" stroke="#aee3ff" stroke-width="6" stroke-linecap="round"/>
      ${drop(34, 6, 0.8, '#dff4ff', '#3a7ca5')}${drop(66, 6, 0.8, '#dff4ff', '#3a7ca5')}${drop(22, 14, 0.6, '#dff4ff', '#3a7ca5')}${drop(78, 14, 0.6, '#dff4ff', '#3a7ca5')}
      <ellipse cx="50" cy="58" rx="36" ry="25" fill="${shell}" ${k.S}/>
      <path d="M30 50 L40 44 L50 50 L60 44 L70 50 M40 44 L40 36 M60 44 L60 36 M50 50 L50 60" fill="none" stroke="${k.lt}" stroke-width="1.8" opacity="0.7"/>
      <rect x="18" y="74" width="12" height="12" rx="5" fill="${k.dk}" ${k.S}/><rect x="70" y="74" width="12" height="12" rx="5" fill="${k.dk}" ${k.S}/>
      <ellipse cx="50" cy="72" rx="31" ry="16" fill="${body}" ${k.S}/>
      <circle cx="33" cy="47" r="10" fill="${body}" ${k.S}/><circle cx="67" cy="47" r="10" fill="${body}" ${k.S}/>
      ${eye(33, 47, 6, k.ln, { iris: '#0e3a5c', fierce: 'l' })}${eye(67, 47, 6, k.ln, { iris: '#0e3a5c', fierce: 'r' })}
      <path d="M30 72 Q50 84 70 72" fill="none" stroke="${k.ln}" stroke-width="2.5"/>
      <circle cx="40" cy="64" r="2" fill="${k.lt}"/><circle cx="62" cy="62" r="2.4" fill="${k.lt}"/><circle cx="55" cy="66" r="1.6" fill="${k.lt}"/>`;
  },
  // ------------------------------------------------------------ moths
  fizzbit: (k) => {
    const wing = k.lin('w', [[0, '#fffbe0'], [1, '#f7c948']]);
    const zig = (x: number, y: number, flip: number) => `<path d="M${x} ${y} l${6 * flip} 4 ${-3 * flip} 2 ${7 * flip} 5" fill="none" stroke="#e67e22" stroke-width="1.8"/>`;
    return `
      <ellipse cx="28" cy="40" rx="20" ry="14" transform="rotate(-28 28 40)" fill="${wing}" ${k.S}/>
      <ellipse cx="72" cy="40" rx="20" ry="14" transform="rotate(28 72 40)" fill="${wing}" ${k.S}/>
      <ellipse cx="32" cy="64" rx="13" ry="9" transform="rotate(25 32 64)" fill="${wing}" ${k.S}/>
      <ellipse cx="68" cy="64" rx="13" ry="9" transform="rotate(-25 68 64)" fill="${wing}" ${k.S}/>
      ${zig(18, 34, 1)}${zig(82, 34, -1)}
      <path d="M45 34 Q36 14 28 12" fill="none" stroke="${k.ln}" stroke-width="2"/><path d="M55 34 Q64 14 72 12" fill="none" stroke="${k.ln}" stroke-width="2"/>
      <circle cx="28" cy="12" r="7" fill="${k.glow('a', '#fff27a')}"/><circle cx="72" cy="12" r="7" fill="${k.glow('a2', '#fff27a')}"/>
      <circle cx="28" cy="12" r="2.6" fill="#fff27a" ${k.S}/><circle cx="72" cy="12" r="2.6" fill="#fff27a" ${k.S}/>
      <ellipse cx="50" cy="60" rx="11" ry="18" fill="${k.shade('b')}" ${k.S}/>
      <path d="M41 60 H59 M42 68 H58" stroke="${k.dk}" stroke-width="2.2"/>
      <circle cx="42" cy="44" r="5" fill="#fff"/><circle cx="50" cy="42" r="6" fill="#fff"/><circle cx="58" cy="44" r="5" fill="#fff"/>
      <circle cx="50" cy="46" r="10" fill="${k.shade('h')}" ${k.S}/>
      ${eye(45, 45, 4.2, k.ln, { iris: '#5b2c00' })}${eye(55, 45, 4.2, k.ln, { iris: '#5b2c00' })}`;
  },
  glimmoth: (k) => {
    const wing = k.lin('w', [[0, '#e8d4ff'], [0.5, k.c], [1, '#6ee7f5']]);
    const spot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="6" fill="#ffd166" ${k.S}/><circle cx="${x}" cy="${y}" r="3" fill="#2a1a4a"/>`;
    return `
      <circle cx="50" cy="50" r="44" fill="${k.glow('g', '#d9b8ff')}"/>
      <path d="M48 44 Q16 6 6 32 Q4 54 46 52 Z" fill="${wing}" ${k.S}/><path d="M52 44 Q84 6 94 32 Q96 54 54 52 Z" fill="${wing}" ${k.S}/>
      <path d="M48 56 Q20 60 20 84 Q38 88 48 62 Z" fill="${wing}" ${k.S}/><path d="M52 56 Q80 60 80 84 Q62 88 52 62 Z" fill="${wing}" ${k.S}/>
      <path d="M44 46 Q24 30 14 34 M56 46 Q76 30 86 34" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.6"/>
      ${spot(24, 34)}${spot(76, 34)}
      ${sparkle(12, 60, 4, '#ffffff')}${sparkle(88, 62, 3.5, '#b8f6ff')}${sparkle(50, 8, 3, '#ffffff')}${sparkle(30, 90, 2.5, '#e3c8ff')}
      <ellipse cx="50" cy="60" rx="7" ry="20" fill="${k.shade('b')}" ${k.S}/>
      <path d="M46 32 Q36 14 30 12 M38 22 L34 18 M42 26 L38 24" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <path d="M54 32 Q64 14 70 12 M62 22 L66 18 M58 26 L62 24" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <circle cx="50" cy="38" r="9" fill="${k.shade('h')}" ${k.S}/>
      ${eye(46, 38, 3.4, k.ln, { glow: '#7ff6ff' })}${eye(54, 38, 3.4, k.ln, { glow: '#7ff6ff' })}`;
  },
  // ------------------------------------------------------------ moles
  cragmole: (k) => {
    const body = k.shade('b');
    const claw = (x: number, flip: number) => `<polygon points="${x},62 ${x - 10 * flip},54 ${x - 6 * flip},62 ${x - 14 * flip},62 ${x - 7 * flip},68 ${x - 12 * flip},74 ${x},72" fill="#d5d8dc" ${k.S}/>`;
    return `
      <circle cx="50" cy="60" r="28" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="70" rx="16" ry="12" fill="${k.lt}" opacity="0.6"/>
      ${claw(24, 1)}${claw(76, -1)}
      <polygon points="26,46 32,28 50,20 68,28 74,46 50,40" fill="${k.shade('r', '#95a5a6')}" ${k.S}/>
      <path d="M40 30 L44 36 L40 40 M60 28 L56 34" fill="none" stroke="${k.ln}" stroke-width="1.5"/>
      ${eye(40, 52, 3.6, k.ln, { iris: '#1a1a1a' })}${eye(60, 52, 3.6, k.ln, { iris: '#1a1a1a' })}
      <ellipse cx="50" cy="64" rx="10" ry="7" fill="#f1a7a7" ${k.S}/>
      <circle cx="47" cy="63" r="1.5" fill="#7a3b3b"/><circle cx="53" cy="63" r="1.5" fill="#7a3b3b"/>
      <path d="M38 64 L28 62 M38 67 L28 69 M62 64 L72 62 M62 67 L72 69" stroke="${k.ln}" stroke-width="1.2"/>`;
  },
  drillord: (k) => {
    const body = k.shade('b');
    const metal = k.lin('m', [[0, '#f4f6f7'], [0.5, '#aab7b8'], [1, '#5d6d7e']], false);
    const claw = (x: number, flip: number) => `<polygon points="${x},58 ${x - 14 * flip},48 ${x - 8 * flip},58 ${x - 18 * flip},60 ${x - 9 * flip},66 ${x - 16 * flip},74 ${x},70" fill="${metal}" ${k.S}/>`;
    return `
      <circle cx="50" cy="56" r="28" fill="${body}" ${k.S}/>
      <path d="M26 50 Q50 40 74 50 M24 62 Q50 52 76 62" fill="none" stroke="${k.lt}" stroke-width="3" opacity="0.55"/>
      <polygon points="32,34 40,20 50,30 60,20 68,34" fill="${k.dk}" ${k.S}/>
      ${claw(22, 1)}${claw(78, -1)}
      <polygon points="38,62 62,62 50,96" fill="${metal}" ${k.S}/>
      <path d="M40 68 L60 66 M42 75 L58 73 M44 82 L56 80 M46 89 L54 87" stroke="${k.ln}" stroke-width="1.6"/>
      ${eye(40, 47, 4, k.ln, { glow: '#ff9f43', fierce: 'l' })}${eye(60, 47, 4, k.ln, { glow: '#ff9f43', fierce: 'r' })}`;
  },
  // ------------------------------------------------------------ fish
  puddlefin: (k) => {
    const body = k.shade('b');
    return `
      <circle cx="80" cy="26" r="4" fill="none" stroke="#c9f5ec" stroke-width="1.8"/><circle cx="88" cy="16" r="2.6" fill="none" stroke="#c9f5ec" stroke-width="1.6"/>
      <circle cx="74" cy="14" r="2" fill="none" stroke="#c9f5ec" stroke-width="1.4"/>
      <path d="M68 58 L92 40 L86 60 L92 80 Z" fill="${k.lt}" ${k.S}/>
      <path d="M36 42 Q50 20 64 42 Z" fill="${k.lt}" ${k.S}/>
      <ellipse cx="48" cy="60" rx="27" ry="21" fill="${body}" ${k.S}/>
      <path d="M58 46 Q64 60 58 74" fill="none" stroke="${k.dk}" stroke-width="2"/>
      <path d="M40 70 Q48 80 56 72 Q50 70 40 70 Z" fill="${k.lt}" ${k.S}/>
      <ellipse cx="44" cy="48" rx="10" ry="4" fill="#fff" opacity="0.35"/>
      ${eye(34, 56, 8, k.ln, { iris: '#117a65' })}
      <circle cx="24" cy="66" r="3" fill="${k.dk}" ${k.S}/>`;
  },
  abyssqual: (k) => {
    const body = k.shade('b');
    return `
      <circle cx="24" cy="18" r="16" fill="${k.glow('l', '#7ff6ff')}"/>
      <path d="M50 38 Q44 12 26 18" fill="none" stroke="${k.ln}" stroke-width="2.4"/>
      <circle cx="24" cy="18" r="5" fill="#d9fffb" ${k.S}/>
      <polygon points="74,52 96,36 90,58 98,80 74,66" fill="${k.dk}" ${k.S}/>
      <polygon points="40,40 50,26 54,40 62,28 64,42" fill="${k.dk}" ${k.S}/>
      <ellipse cx="54" cy="58" rx="30" ry="22" fill="${body}" ${k.S}/>
      <path d="M26 56 Q40 66 26 78 Q48 82 58 70 Q48 66 26 56 Z" fill="#12091c" ${k.S}/>
      <polygon points="30,60 33,66 36,62 39,68 42,64 45,70" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="miter"/>
      <polygon points="30,76 34,71 38,76 42,71 46,75" fill="none" stroke="#fff" stroke-width="2.2"/>
      <circle cx="62" cy="62" r="2" fill="#7ff6ff"/><circle cx="70" cy="56" r="2" fill="#7ff6ff"/><circle cx="66" cy="70" r="1.6" fill="#7ff6ff"/><circle cx="76" cy="64" r="1.6" fill="#7ff6ff"/>
      ${eye(48, 46, 4.2, k.ln, { glow: '#ffe66d', fierce: 'l' })}`;
  },
  stormfin: (k) => {
    const body = k.shade('b');
    const fin = k.lin('f', [[0, '#e0fff8'], [1, k.c]]);
    return `
      <path d="M14 62 l8 -3 -2 4 8 -2" fill="none" stroke="#fff27a" stroke-width="2"/><path d="M86 84 l-6 -4 4 -1 -6 -4" fill="none" stroke="#fff27a" stroke-width="2"/>
      <path d="M40 54 Q30 12 66 10 Q52 30 56 52 Z" fill="${fin}" ${k.S}/>
      <path d="M44 22 l6 6 -4 2 8 8" fill="none" stroke="#fff27a" stroke-width="2"/>
      <polygon points="74,58 96,44 90,62 96,80" fill="${fin}" ${k.S}/>
      <ellipse cx="50" cy="62" rx="28" ry="15" transform="rotate(-8 50 62)" fill="${body}" ${k.S}/>
      <path d="M30 66 Q50 74 72 62" fill="none" stroke="${k.lt}" stroke-width="3" opacity="0.7"/>
      <path d="M46 70 Q42 86 60 82 Q56 76 54 70 Z" fill="${fin}" ${k.S}/>
      ${bolt(62, 60, 0.4, '#fff27a', k.ln, 15)}
      ${eye(32, 58, 5.5, k.ln, { iris: '#f1c40f', fierce: 'l' })}
      <path d="M22 64 Q26 67 30 65" fill="none" stroke="${k.ln}" stroke-width="1.6"/>`;
  },
  // ------------------------------------------------------------ drakes
  mirelurk: (k) => {
    const body = k.shade('b');
    return `
      <path d="M26 90 Q24 60 40 44 Q52 34 64 40 L60 52 Q46 54 42 72 L46 90 Z" fill="${body}" ${k.S}/>
      <path d="M30 70 Q38 72 34 80 M40 56 Q46 60 42 66" fill="none" stroke="#7fb069" stroke-width="2.4"/>
      <polygon points="56,30 50,12 64,26" fill="${k.lt}" ${k.S}/><polygon points="70,26 72,8 80,26" fill="${k.lt}" ${k.S}/>
      <ellipse cx="68" cy="38" rx="20" ry="12" transform="rotate(-10 68 38)" fill="${body}" ${k.S}/>
      <path d="M78 42 Q86 44 90 40" fill="none" stroke="${k.ln}" stroke-width="2"/>
      <polygon points="84,42 86,46 88,41" fill="#fff"/>
      ${eye(66, 34, 4.5, k.ln, { glow: '#f7dc6f', fierce: 'r' })}
      <path d="M0 78 Q12 74 24 78 T48 78 T72 78 T100 78 V100 H0 Z" fill="${k.lin('w', [[0, '#3a7d8c', 0.85], [1, '#123a44', 0.95]])}"/>
      <path d="M8 84 Q16 82 24 84 M56 86 Q66 84 76 86" fill="none" stroke="#bfeaf0" stroke-width="1.5" opacity="0.7"/>`;
  },
  thundrake: (k) => {
    const body = k.shade('b');
    const wing = k.lin('w', [[0, '#fff8d0'], [1, '#e0a800']]);
    return `
      <g opacity="0.9"><circle cx="30" cy="16" r="10" fill="#5d6d7e"/><circle cx="46" cy="10" r="12" fill="#6c7a89"/><circle cx="62" cy="14" r="10" fill="#5d6d7e"/><circle cx="74" cy="20" r="7" fill="#4d5d6c"/></g>
      ${bolt(70, 30, 0.7, '#fff27a', '#5d4a00', 15)}
      <path d="M38 52 L4 26 L12 46 L2 54 L14 60 L36 62 Z" fill="${wing}" ${k.S}/><path d="M62 52 L96 26 L88 46 L98 54 L86 60 L64 62 Z" fill="${wing}" ${k.S}/>
      <path d="M8 32 l8 8 -4 2 10 10 M92 32 l-8 8 4 2 -10 10" fill="none" stroke="#e67e22" stroke-width="1.8"/>
      <path d="M66 78 l12 -4 -4 6 14 -2" fill="none" stroke="${k.ln}" stroke-width="5" stroke-linecap="round"/>
      <path d="M66 78 l12 -4 -4 6 14 -2" fill="none" stroke="#ffd23f" stroke-width="2.5" stroke-linecap="round"/>
      <ellipse cx="50" cy="68" rx="20" ry="17" fill="${body}" ${k.S}/>
      <path d="M42 62 H58 M41 68 H59 M42 74 H58" stroke="${k.lt}" stroke-width="2.2"/>
      <rect x="43" y="40" width="14" height="18" rx="6" fill="${body}" ${k.S}/>
      <path d="M38 30 Q30 20 34 10 Q40 22 44 26 Z" fill="#fff8e1" ${k.S}/><path d="M62 30 Q70 20 66 10 Q60 22 56 26 Z" fill="#fff8e1" ${k.S}/>
      <ellipse cx="50" cy="36" rx="15" ry="12" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="43" rx="8" ry="5" fill="${k.lt}"/>
      ${eye(44, 33, 4, k.ln, { iris: '#1e8bc3', fierce: 'l' })}${eye(56, 33, 4, k.ln, { iris: '#1e8bc3', fierce: 'r' })}
      <polygon points="46,46 47.5,49 49,46" fill="#fff"/><polygon points="51,46 52.5,49 54,46" fill="#fff"/>`;
  },
  // ------------------------------------------------------------ crystals & golems
  aurorix: (k) => {
    const aurora = k.lin('a', [[0, '#7ff6e0'], [0.45, '#8e7bff'], [1, '#ff8ad8']], false);
    return `
      <circle cx="50" cy="52" r="46" fill="${k.glow('g', '#8ef0e0')}"/>
      <polygon points="38,12 42,4 46,12 42,18" fill="${aurora}" ${k.S}/><polygon points="50,8 54,0 58,8 54,14" fill="${aurora}" ${k.S}/>
      <polygon points="62,12 66,4 70,12 66,18" fill="${aurora}" ${k.S}/>
      <polygon points="10,50 16,40 22,50 16,58" fill="${aurora}" ${k.S}/><polygon points="78,46 84,36 90,46 84,54" fill="${aurora}" ${k.S}/>
      <polygon points="50,18 80,36 74,84 26,84 20,36" fill="${aurora}" ${k.S}/>
      <path d="M50 18 L50 84 M20 36 L50 52 L80 36 M26 84 L50 52 L74 84" fill="none" stroke="#ffffff" stroke-width="1.4" opacity="0.6"/>
      <polygon points="50,18 66,30 50,40 34,30" fill="#fff" opacity="0.35"/>
      <circle cx="50" cy="64" r="9" fill="${k.glow('c', '#ffffff')}"/><circle cx="50" cy="64" r="3.5" fill="#fff"/>
      ${eye(41, 50, 5, k.ln, { iris: '#16a085' })}${eye(59, 50, 5, k.ln, { iris: '#16a085' })}
      ${sparkle(86, 70, 3, '#fff')}${sparkle(14, 26, 2.6, '#fff')}`;
  },
  voltgeode: (k) => {
    const rock = k.shade('r', '#7a6a4f');
    return `
      <circle cx="50" cy="56" r="34" fill="${k.glow('g', '#fff27a')}"/>
      <polygon points="30,30 34,12 40,28" fill="${k.shade('s', k.c)}" ${k.S}/><polygon points="44,24 50,4 56,24" fill="${k.shade('s2', k.c)}" ${k.S}/>
      <polygon points="60,28 66,10 70,30" fill="${k.shade('s3', k.c)}" ${k.S}/>
      <polygon points="18,84 14,52 26,30 50,24 74,30 86,52 82,84" fill="${rock}" ${k.S}/>
      <polygon points="48,30 56,44 50,48 60,64 52,66 56,84 40,62 48,58 40,44 46,42" fill="#fff6a8" stroke="#e0a800" stroke-width="2"/>
      <path d="M8 46 l6 4 -3 2 6 4 M92 46 l-6 4 3 2 -6 4" fill="none" stroke="#fff27a" stroke-width="2"/>
      <rect x="26" y="40" width="20" height="8" rx="4" fill="#1d1a12"/><rect x="56" y="40" width="20" height="8" rx="4" fill="#1d1a12"/>
      <ellipse cx="36" cy="44" rx="6" ry="2.6" fill="#fff27a"/><ellipse cx="66" cy="44" rx="6" ry="2.6" fill="#fff27a"/>`;
  },
  golemar: (k) => {
    const stone = k.shade('b');
    const tower = (x: number) => `<rect x="${x}" y="34" width="20" height="30" rx="2" fill="${k.shade('t' + x, shade(k.c, -0.1))}" ${k.S}/>
      <path d="M${x} 34 v-6 h5 v6 h5 v-6 h5 v6 h5 v-6" fill="${k.dk}" ${k.S}/>`;
    return `
      ${tower(8)}${tower(72)}
      <polygon points="22,88 25,40 75,40 78,88" fill="${stone}" ${k.S}/>
      <path d="M25 56 H75 M24 72 H76 M40 40 V56 M60 56 V72 M42 72 V88" stroke="${k.dk}" stroke-width="1.6"/>
      <circle cx="50" cy="64" r="8" fill="none" stroke="#7ff6ff" stroke-width="2.4"/>
      <path d="M50 56 V72 M42 64 H58" stroke="#7ff6ff" stroke-width="1.6"/>
      <circle cx="50" cy="64" r="12" fill="${k.glow('r', '#7ff6ff')}"/>
      <rect x="34" y="16" width="32" height="26" rx="5" fill="${stone}" ${k.S}/>
      <rect x="38" y="25" width="24" height="7" rx="3.5" fill="#101820"/>
      <rect x="40" y="27" width="20" height="3" rx="1.5" fill="#7ff6ff"/>
      <ellipse cx="30" cy="86" rx="8" ry="3" fill="#6b9a4a" opacity="0.8"/><ellipse cx="74" cy="44" rx="6" ry="2.5" fill="#6b9a4a" opacity="0.8"/>`;
  },
  bogrock: (k) => {
    const body = k.shade('b');
    return `
      <path d="M30 86 Q28 92 32 94 Q36 92 34 86 Z" fill="#5a4320"/><path d="M66 88 Q64 95 68 97 Q72 95 70 88 Z" fill="#5a4320"/>
      <path d="M16 66 Q18 34 50 32 Q82 34 84 66 Z" fill="${k.shade('r', '#8a7f6a')}" ${k.S}/>
      <path d="M34 40 L40 48 L36 56 M62 38 L58 46" fill="none" stroke="${k.ln}" stroke-width="1.6"/>
      <ellipse cx="50" cy="72" rx="34" ry="17" fill="${body}" ${k.S}/>
      <ellipse cx="50" cy="78" rx="20" ry="8" fill="${k.lt}" opacity="0.7"/>
      <circle cx="33" cy="52" r="10" fill="${body}" ${k.S}/><circle cx="67" cy="52" r="10" fill="${body}" ${k.S}/>
      ${eye(33, 52, 6, k.ln, { iris: '#4a3510', sleepy: true, lid: shade(k.c, -0.15) })}${eye(67, 52, 6, k.ln, { iris: '#4a3510', sleepy: true, lid: shade(k.c, -0.15) })}
      <path d="M38 22 A12 9 0 1 1 62 22 L50 22 Z" fill="#4f9a4a" stroke="#2e5e2a" stroke-width="1.8"/>
      <circle cx="56" cy="17" r="3.5" fill="#ff9ad5" stroke="#b0457f" stroke-width="1.2"/>
      <path d="M36 74 Q50 82 64 74" fill="none" stroke="${k.ln}" stroke-width="2.2"/>`;
  },
};

/** Species art (defs + body), or null when the species has no custom art. */
export function speciesArt(species: string, color: string, prefix: string): { defs: string; body: string } | null {
  const fn = ART[species];
  if (!fn) return null;
  const { ctx, defs } = makeCtx(color, prefix);
  const body = fn(ctx);
  return { defs: defs.join(''), body };
}

/**
 * SMIL `begin` that keeps a looping animation in phase with the wall clock, so re-rendered portraits
 * (battle cards are rebuilt every round) carry on smoothly instead of restarting.
 */
function phase(dur: number, offset = 0): string {
  return `-${(((Date.now() / 1000) + offset) % dur).toFixed(2)}s`;
}
const loop = (attr: string, values: string, dur: number, offset = 0) =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" begin="${phase(dur, offset)}" repeatCount="indefinite"/>`;
const spin = (cx: number, cy: number, dur: number, reverse = false) =>
  `<animateTransform attributeName="transform" type="rotate" from="${reverse ? 360 : 0} ${cx} ${cy}" to="${reverse ? 0 : 360} ${cx} ${cy}" dur="${dur}s" begin="${phase(dur)}" repeatCount="indefinite"/>`;

/** One wing of layered feathers fanning up-left from the shoulder (mirrored for the right wing). */
function featherWing(prefix: string, light: string, color: string, animate: boolean): string {
  const rx = 46, ry = 52; // shoulder
  const feather = (angle: number, len: number, width: number, fill: string, op: number) => {
    const a = (angle * Math.PI) / 180;
    const tx = rx + Math.cos(a) * len, ty = ry + Math.sin(a) * len;
    const nx = -Math.sin(a) * width, ny = Math.cos(a) * width;
    const mx = rx + Math.cos(a) * len * 0.55, my = ry + Math.sin(a) * len * 0.55;
    return `<path d="M${rx} ${ry} Q${(mx + nx).toFixed(1)} ${(my + ny).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} Q${(mx - nx * 0.6).toFixed(1)} ${(my - ny * 0.6).toFixed(1)} ${rx} ${ry} Z" fill="${fill}" stroke="${light}" stroke-width="0.8" opacity="${op}"/>`;
  };
  let s = '';
  // long primaries, then shorter coverts on top
  [[-160, 46], [-148, 50], [-136, 50], [-124, 46], [-112, 40], [-172, 38], [-184, 30]].forEach(([ang, len]) => { s += feather(ang, len, 7, `url(#${prefix}-fw)`, 0.92); });
  [[-165, 26], [-150, 30], [-135, 30], [-120, 26]].forEach(([ang, len]) => { s += feather(ang, len, 6, `url(#${prefix}-fc)`, 0.95); });
  s += `<path d="M${rx} ${ry} Q24 26 6 22" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.6"/>`;
  const flap = animate ? `<animateTransform attributeName="transform" type="rotate" values="0 ${rx} ${ry};9 ${rx} ${ry};0 ${rx} ${ry}" dur="2.4s" begin="${phase(2.4)}" repeatCount="indefinite"/>` : '';
  return `<g>${s}${flap}</g>`;
}

/**
 * Evolved forms' flourishes, drawn behind (wings, sigil) and in front (orbs, halo) of the body.
 * Escalates with the tier the species belongs to: ★2 evolutions get sigil + orbs, ★3 wings, ★4 a halo too.
 */
export function flairArt(flair: string[] | undefined, color: string, prefix: string, animate = false): { defs: string; back: string; front: string } {
  if (!flair?.length) return { defs: '', back: '', front: '' };
  const light = shade(color, 0.55);
  const defs = `<linearGradient id="${prefix}-fw" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${light}" stop-opacity="0.95"/><stop offset="0.6" stop-color="${color}" stop-opacity="0.7"/><stop offset="1" stop-color="${shade(color, -0.3)}" stop-opacity="0.25"/></linearGradient>`
    + `<linearGradient id="${prefix}-fc" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${light}"/></linearGradient>`
    + `<radialGradient id="${prefix}-fo"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="${light}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="${prefix}-fh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.5" stop-color="#ffd700"/><stop offset="1" stop-color="#fff3b0"/></linearGradient>`;
  let back = '';
  let front = '';
  if (flair.includes('wings')) {
    const w = featherWing(prefix, light, color, animate);
    back += w + `<g transform="translate(100 0) scale(-1 1)">${w}</g>`;
  }
  if (flair.includes('sigil')) {
    const ring = (rx: number, ry: number, extra: string, anim: string) => `<ellipse cx="50" cy="90" rx="${rx}" ry="${ry}" fill="none" stroke="${light}" ${extra}>${anim}</ellipse>`;
    back += ring(40, 8, 'stroke-width="1.6" opacity="0.85"', '')
      + ring(31, 6, 'stroke-width="1.2" stroke-dasharray="3 4" opacity="0.85"', animate ? loop('stroke-dashoffset', '0;-28', 3) : '')
      + [12, 30, 70, 88].map((x) => `<path d="M${x} 88 l2 -3 l2 3 l-2 3 Z" fill="${light}" opacity="0.9"/>`).join('');
  }
  if (flair.includes('orbs')) {
    front += [[12, 40, 4], [88, 34, 3.5], [84, 74, 3]].map(([x, y, r], i) => {
      const bob = animate ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="${2 + i * 0.4}s" begin="${phase(2 + i * 0.4)}" repeatCount="indefinite"/>` : '';
      return `<g><circle cx="${x}" cy="${y}" r="${r * 2.2}" fill="url(#${prefix}-fo)"/><circle cx="${x}" cy="${y}" r="${r * 0.6}" fill="#fff"/>${bob}</g>`;
    }).join('');
  }
  if (flair.includes('halo')) {
    const bob = animate ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -2.5;0 0" dur="3s" begin="${phase(3)}" repeatCount="indefinite"/>` : '';
    front += `<g><ellipse cx="50" cy="6" rx="17" ry="4.5" fill="none" stroke="#ffe066" stroke-width="6" opacity="0.3"/>`
      + `<ellipse cx="50" cy="6" rx="17" ry="4.5" fill="none" stroke="url(#${prefix}-fh)" stroke-width="2.4"/>`
      + `<ellipse cx="50" cy="6" rx="12" ry="2.6" fill="none" stroke="#fffbe6" stroke-width="0.8" opacity="0.8"/>${bob}</g>`;
  }
  return { defs, back, front };
}

export interface TierFx {
  defs: string;
  back: string;    // behind everything: aura, rays, pedestal
  front: string;   // over the body: motes, orbiting orbs, sparkles
  filter: string;  // filter id for the body's rim light ('' for none)
  sheen: boolean;  // a holographic shine sweeps across the body
}

/**
 * The tier treatment that makes higher tiers look more and more powerful:
 * ★2 soft aura + motes · ★3 rim light + glowing rune pedestal · ★4 turning light rays, orbiting orbs and a shine sweep
 * · ★5 prismatic ring, pulsing double rim and twinkling stars. `animate` = SMIL motion (big portraits only).
 */
export function tierFx(tier: number, color: string, prefix: string, animate: boolean): TierFx {
  const none: TierFx = { defs: '', back: '', front: '', filter: '', sheen: false };
  if (tier <= 1) return none;
  const light = shade(color, 0.55);
  let defs = `<radialGradient id="${prefix}-aura"><stop offset="0" stop-color="${color}" stop-opacity="${0.25 + tier * 0.09}"/><stop offset="0.6" stop-color="${color}" stop-opacity="${0.1 + tier * 0.04}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
  let back = `<circle cx="50" cy="54" r="${38 + tier * 3}" fill="url(#${prefix}-aura)">${animate && tier >= 3 ? loop('opacity', '0.75;1;0.75', 2.6) : ''}</circle>`;
  let front = '';
  let filter = '';

  if (tier >= 5) {
    // prismatic ring
    defs += `<linearGradient id="${prefix}-prism" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset="0.2" stop-color="#ffd93d"/><stop offset="0.4" stop-color="#6bff95"/><stop offset="0.6" stop-color="#4dd2ff"/><stop offset="0.8" stop-color="#b36bff"/><stop offset="1" stop-color="#ff6bd5"/></linearGradient>`;
    back += `<g opacity="0.75"><circle cx="50" cy="52" r="45" fill="none" stroke="url(#${prefix}-prism)" stroke-width="2.2" stroke-dasharray="14 5 3 5"/>`
      + `<circle cx="50" cy="52" r="40" fill="none" stroke="${light}" stroke-width="0.8" stroke-dasharray="1 4"/>${animate ? spin(50, 52, 20) : ''}</g>`;
  }
  if (tier >= 4) {
    // turning god-rays
    defs += `<radialGradient id="${prefix}-ray" cx="50" cy="52" r="50" gradientUnits="userSpaceOnUse"><stop offset="0.25" stop-color="${light}" stop-opacity="0.7"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
    const n = tier >= 5 ? 14 : 10;
    let rays = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, w = 0.09;
      const p = (ang: number, r: number) => `${(50 + Math.cos(ang) * r).toFixed(1)},${(52 + Math.sin(ang) * r).toFixed(1)}`;
      rays += `<polygon points="${p(a - w * 0.3, 14)} ${p(a - w, 52)} ${p(a + w, 52)} ${p(a + w * 0.3, 14)}"/>`;
    }
    back += `<g fill="url(#${prefix}-ray)" opacity="${tier >= 5 ? 0.55 : 0.5}">${rays}${animate ? spin(50, 52, 30) : ''}</g>`;
    if (tier >= 5) back += `<g fill="#ffffff" opacity="0.1" transform="rotate(${180 / n} 50 52)">${rays}${animate ? spin(50, 52, 45, true) : ''}</g>`;
  }
  if (tier >= 3) {
    // glowing rune pedestal under the feet
    defs += `<radialGradient id="${prefix}-ped"><stop offset="0" stop-color="${light}" stop-opacity="0.8"/><stop offset="0.6" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
    back += `<ellipse cx="50" cy="90" rx="38" ry="8.5" fill="url(#${prefix}-ped)"/>`
      + `<ellipse cx="50" cy="90" rx="33" ry="6.5" fill="none" stroke="${light}" stroke-width="1.3" stroke-dasharray="6 3 1 3" opacity="0.9">${animate ? loop('stroke-dashoffset', '0;-26', 2.4) : ''}</ellipse>`;
    if (tier >= 4) back += `<ellipse cx="50" cy="90" rx="24" ry="4.5" fill="none" stroke="#fff" stroke-width="0.8" stroke-dasharray="2 3" opacity="0.8">${animate ? loop('stroke-dashoffset', '0;20', 2) : ''}</ellipse>`;
    // rim light around the body
    const [r, blur, op] = tier >= 5 ? [1.7, 2.6, 1] : tier >= 4 ? [1.4, 2.1, 0.95] : [1, 1.5, 0.8];
    filter = `${prefix}-rim`;
    defs += `<filter id="${filter}" x="-30%" y="-30%" width="160%" height="160%">`
      + `<feMorphology in="SourceAlpha" operator="dilate" radius="${r}" result="d"/>`
      + `<feGaussianBlur in="d" stdDeviation="${blur}" result="b">${animate && tier >= 5 ? loop('stdDeviation', `${blur};${blur * 1.7};${blur}`, 1.8) : ''}</feGaussianBlur>`
      + `<feFlood flood-color="${color}" flood-opacity="${op}"/><feComposite in2="b" operator="in" result="g"/>`
      + (tier >= 5 ? `<feMorphology in="SourceAlpha" operator="dilate" radius="0.7" result="d2"/><feGaussianBlur in="d2" stdDeviation="0.6" result="b2"/><feFlood flood-color="#fffbe6"/><feComposite in2="b2" operator="in" result="g2"/>` : '')
      + `<feMerge><feMergeNode in="g"/>${tier >= 5 ? '<feMergeNode in="g2"/>' : ''}<feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  }

  // rising energy motes
  const motes = tier * 2;
  for (let i = 0; i < motes; i++) {
    const x = 14 + ((i * 37) % 72), r = 0.9 + ((i * 7) % 3) * 0.45, dur = 2.6 + ((i * 13) % 7) * 0.3;
    const fill = i % 3 === 0 ? '#ffffff' : light;
    if (animate) {
      front += `<circle cx="${x}" cy="88" r="${r}" fill="${fill}" opacity="0">`
        + loop('cy', `88;${30 - (i % 4) * 5}`, dur, i * 0.7) + loop('opacity', '0;0.95;0', dur, i * 0.7) + `</circle>`;
    } else {
      front += `<circle cx="${x}" cy="${40 + ((i * 23) % 44)}" r="${r}" fill="${fill}" opacity="0.75"/>`;
    }
  }
  if (tier >= 4) {
    // two orbs circling the monster
    defs += `<radialGradient id="${prefix}-orb"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="${light}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
    const orbit = 'M8 60 A42 13 0 1 1 92 60 A42 13 0 1 1 8 60 Z';
    for (let i = 0; i < 2; i++) {
      if (animate) {
        front += `<g><circle r="6" fill="url(#${prefix}-orb)"/><circle r="1.6" fill="#fff"/>`
          + `<animateMotion path="${orbit}" dur="5s" begin="${phase(5, i * 2.5)}" repeatCount="indefinite"/></g>`;
      } else {
        front += `<g transform="translate(${i ? 90 : 10} ${i ? 56 : 64})"><circle r="6" fill="url(#${prefix}-orb)"/><circle r="1.6" fill="#fff"/></g>`;
      }
    }
  }
  if (tier >= 5) {
    // twinkling stars
    [[12, 16, 4.5], [88, 20, 4], [92, 78, 3], [8, 76, 3.2], [50, 4, 3.5], [72, 10, 2.4]].forEach(([x, y, r], i) => {
      const fill = i % 2 ? '#ffffff' : color;
      front += animate
        ? `<g>${sparkle(x, y, r, fill)}<animate attributeName="opacity" values="0.15;1;0.15" dur="${1.4 + i * 0.25}s" begin="${phase(1.4 + i * 0.25)}" repeatCount="indefinite"/></g>`
        : sparkle(x, y, r, fill);
    });
  }
  return { defs, back, front, filter, sheen: animate && tier >= 4 };
}

/** A diagonal shine that sweeps across the body (masked to its silhouette via a whitened copy). */
export function sheenDefs(prefix: string): string {
  return `<filter id="${prefix}-white" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0"/></filter>`
    + `<linearGradient id="${prefix}-sg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<mask id="${prefix}-sm" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect x="-40" y="-20" width="26" height="140" fill="url(#${prefix}-sg)" transform="rotate(20 50 50)">`
    + `<animate attributeName="x" values="-60;-60;140" keyTimes="0;0.55;1" dur="3.6s" begin="${phase(3.6)}" repeatCount="indefinite"/></rect></mask>`;
}
