// Procedural SVG portraits so the game needs no art assets. Driven by `shape` + `color` in the data files.
import { flairArt, sheenDefs, speciesArt, tierFx } from './monsterart';

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function eye(x: number, y: number, r: number, glow?: string) {
  if (glow) return `<circle cx="${x}" cy="${y}" r="${r}" fill="${glow}"/><circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="#fff"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x + r * 0.15}" cy="${y + r * 0.1}" r="${r * 0.55}" fill="#222"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.25}" r="${r * 0.2}" fill="#fff"/>`;
}

const BODIES: Record<string, (c: string, d: string, l: string) => string> = {
  fox: (c, d, l) => `
    <path d="M70 70 Q96 60 88 30 Q80 50 66 58 Z" fill="${l}" stroke="${d}" stroke-width="2"/>
    <polyline points="80,36 84,44 78,46 84,54" fill="none" stroke="#fff" stroke-width="2"/>
    <ellipse cx="50" cy="68" rx="24" ry="20" fill="${c}" stroke="${d}" stroke-width="2"/>
    <polygon points="32,36 36,10 48,30" fill="${c}" stroke="${d}" stroke-width="2"/>
    <polygon points="68,36 64,10 52,30" fill="${c}" stroke="${d}" stroke-width="2"/>
    <circle cx="50" cy="44" r="20" fill="${c}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="50" cy="52" rx="10" ry="7" fill="${l}"/>
    ${eye(42, 42, 5)}${eye(58, 42, 5)}<circle cx="50" cy="50" r="2.5" fill="#222"/>`,
  rock: (c, d, l) => `
    <polygon points="20,80 14,52 28,26 52,16 74,24 88,50 82,80" fill="${c}" stroke="${d}" stroke-width="3"/>
    <polyline points="30,30 40,46 34,60" fill="none" stroke="${d}" stroke-width="2"/>
    <polyline points="74,30 66,40 72,54" fill="none" stroke="${d}" stroke-width="2"/>
    <polygon points="28,30 44,20 40,32" fill="${l}"/>
    ${eye(40, 54, 6)}${eye(62, 54, 6)}<path d="M42 68 Q51 74 60 68" stroke="#222" stroke-width="2.5" fill="none"/>`,
  toad: (c, d, l) => `
    <ellipse cx="50" cy="66" rx="36" ry="24" fill="${c}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="50" cy="72" rx="24" ry="14" fill="${l}"/>
    <circle cx="33" cy="42" r="12" fill="${c}" stroke="${d}" stroke-width="2"/>
    <circle cx="67" cy="42" r="12" fill="${c}" stroke="${d}" stroke-width="2"/>
    ${eye(33, 42, 7)}${eye(67, 42, 7)}
    <path d="M34 62 Q50 72 66 62" stroke="#222" stroke-width="2.5" fill="none"/>
    <path d="M50 8 Q42 20 50 24 Q58 20 50 8 Z" fill="#aee3ff" stroke="${d}" stroke-width="1.5"/>`,
  moth: (c, d, l) => `
    <ellipse cx="28" cy="46" rx="22" ry="28" fill="${l}" stroke="${d}" stroke-width="2" transform="rotate(-20 28 46)"/>
    <ellipse cx="72" cy="46" rx="22" ry="28" fill="${l}" stroke="${d}" stroke-width="2" transform="rotate(20 72 46)"/>
    <circle cx="26" cy="44" r="7" fill="${c}"/><circle cx="74" cy="44" r="7" fill="${c}"/>
    <ellipse cx="50" cy="58" rx="12" ry="24" fill="${c}" stroke="${d}" stroke-width="2"/>
    <path d="M45 34 Q38 16 30 14 M55 34 Q62 16 70 14" stroke="${d}" stroke-width="2" fill="none"/>
    <circle cx="30" cy="14" r="3" fill="${c}"/><circle cx="70" cy="14" r="3" fill="${c}"/>
    ${eye(45, 44, 4.5)}${eye(55, 44, 4.5)}`,
  mole: (c, d, l) => `
    <circle cx="50" cy="58" r="30" fill="${c}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="50" cy="66" rx="12" ry="9" fill="#e8a0a0" stroke="${d}" stroke-width="1.5"/>
    <circle cx="50" cy="62" r="3" fill="#7a3b3b"/>
    <polygon points="18,70 8,64 10,76 6,84 20,80" fill="#eee" stroke="${d}" stroke-width="1.5"/>
    <polygon points="82,70 92,64 90,76 94,84 80,80" fill="#eee" stroke="${d}" stroke-width="1.5"/>
    <ellipse cx="50" cy="40" rx="18" ry="6" fill="${l}" opacity="0.6"/>
    ${eye(39, 50, 3.5)}${eye(61, 50, 3.5)}`,
  fish: (c, d, l) => `
    <polygon points="72,56 94,38 94,74" fill="${l}" stroke="${d}" stroke-width="2"/>
    <polygon points="38,40 54,22 62,42" fill="${l}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="46" cy="56" rx="32" ry="20" fill="${c}" stroke="${d}" stroke-width="2"/>
    <path d="M56 44 Q62 56 56 68" stroke="${d}" stroke-width="2" fill="none"/>
    ${eye(30, 52, 6)}<path d="M18 62 Q22 66 26 63" stroke="#222" stroke-width="2" fill="none"/>`,
  drake: (c, d, l) => `
    <path d="M30 50 L6 30 L14 56 Z" fill="${l}" stroke="${d}" stroke-width="2"/>
    <path d="M70 50 L94 30 L86 56 Z" fill="${l}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="50" cy="68" rx="26" ry="20" fill="${c}" stroke="${d}" stroke-width="2"/>
    <rect x="42" y="36" width="16" height="24" rx="6" fill="${c}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="50" cy="32" rx="18" ry="14" fill="${c}" stroke="${d}" stroke-width="2"/>
    <polygon points="38,22 30,6 44,20" fill="#ddd"/><polygon points="62,22 70,6 56,20" fill="#ddd"/>
    ${eye(43, 30, 4, '#f7dc6f')}${eye(57, 30, 4, '#f7dc6f')}`,
  crystal: (c, d, l) => `
    <circle cx="50" cy="52" r="42" fill="${l}" opacity="0.25"/>
    <polygon points="50,6 80,34 72,86 28,86 20,34" fill="${c}" stroke="${d}" stroke-width="2.5"/>
    <path d="M50 6 L50 86 M20 34 L50 50 L80 34" fill="none" stroke="${l}" stroke-width="2"/>
    <polygon points="50,6 66,30 50,40 34,30" fill="${l}" opacity="0.8"/>
    ${eye(40, 56, 5)}${eye(60, 56, 5)}`,
  brute: (c, d, l) => `
    <polygon points="16,40 24,20 32,36 40,12 50,32 60,12 68,36 76,20 84,40" fill="${d}"/>
    <path d="M10 92 Q6 40 50 34 Q94 40 90 92 Z" fill="${c}" stroke="${d}" stroke-width="3"/>
    <ellipse cx="50" cy="56" rx="26" ry="18" fill="${l}" opacity="0.4"/>
    ${eye(38, 52, 5, '#ff5a3c')}${eye(62, 52, 5, '#ff5a3c')}
    <path d="M30 70 L70 70 L66 82 L34 82 Z" fill="#2b1a10"/>
    <polygon points="36,70 40,78 44,70" fill="#fff"/><polygon points="56,70 60,78 64,70" fill="#fff"/>`,
  bird: (c, d, l) => `
    <polygon points="50,46 2,20 18,60 30,56" fill="${l}" stroke="${d}" stroke-width="2"/>
    <polygon points="50,46 98,20 82,60 70,56" fill="${l}" stroke="${d}" stroke-width="2"/>
    <polyline points="12,28 22,40 16,42 28,52" fill="none" stroke="#fff27a" stroke-width="2"/>
    <polyline points="88,28 78,40 84,42 72,52" fill="none" stroke="#fff27a" stroke-width="2"/>
    <ellipse cx="50" cy="62" rx="18" ry="26" fill="${c}" stroke="${d}" stroke-width="2"/>
    <polygon points="44,22 50,4 56,22" fill="#fff27a"/>
    <circle cx="50" cy="32" r="14" fill="${c}" stroke="${d}" stroke-width="2"/>
    <polygon points="46,38 54,38 50,50" fill="#f5b041"/>
    ${eye(44, 30, 4, '#fff27a')}${eye(56, 30, 4, '#fff27a')}`,
  serpent: (c, d, l) => `
    <path d="M14 90 Q10 60 40 64 Q70 68 70 48 Q70 30 52 28" fill="none" stroke="${d}" stroke-width="22" stroke-linecap="round"/>
    <path d="M14 90 Q10 60 40 64 Q70 68 70 48 Q70 30 52 28" fill="none" stroke="${c}" stroke-width="16" stroke-linecap="round"/>
    <path d="M20 84 Q18 66 40 70 Q74 72 76 48" fill="none" stroke="${l}" stroke-width="3" stroke-dasharray="4 6"/>
    <polygon points="62,18 88,6 76,26" fill="${l}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="50" cy="26" rx="20" ry="14" fill="${c}" stroke="${d}" stroke-width="2"/>
    ${eye(44, 22, 4, '#7dffea')}${eye(58, 22, 4, '#7dffea')}
    <path d="M36 32 Q50 40 64 32" stroke="#0b3d33" stroke-width="2.5" fill="none"/>`,
};

let svgCounter = 0;

/**
 * Portrait for `key`: a species id with custom art (see monsterart.ts), otherwise a generic `shape` template.
 * Higher tiers get a glowing aura in the tier colour.
 */
export function portraitSVG(
  key: string, color: string, size = 64, aura?: { tier: number; color: string }, fallbackShape = key, artKey?: string, flair?: string[], animate = size >= 56,
): string {
  // gradient ids must be unique per <svg>, since many portraits share one page
  const prefix = `p${(++svgCounter).toString(36)}`;
  // evolved forms reuse their base species' drawing, in their own colours
  const art = speciesArt(artKey ?? key, color, prefix);
  // `animate`: SMIL motion where it can be seen (battle cards, popups); small icons and map textures stay static
  const extra = flairArt(flair, color, prefix, animate);
  const fx = aura ? tierFx(aura.tier, aura.color, prefix, animate) : null;
  const body = art?.body ?? (BODIES[fallbackShape] ?? BODIES.rock)(color, shade(color, -0.45), shade(color, 0.45));
  const ground = '<ellipse cx="50" cy="91" rx="26" ry="5" fill="#000" opacity="0.22"/>';
  const bodyGroup = `<g id="${prefix}-body">${body}</g>`;
  const lit = fx?.filter ? `<g filter="url(#${fx.filter})">${bodyGroup}</g>` : bodyGroup;
  const sheen = fx?.sheen ? `<use href="#${prefix}-body" filter="url(#${prefix}-white)" mask="url(#${prefix}-sm)"/>` : '';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
    + `<defs>${art?.defs ?? ''}${fx?.defs ?? ''}${fx?.sheen ? sheenDefs(prefix) : ''}${extra.defs}</defs>`
    + `${fx?.back ?? ''}${extra.back}${ground}${lit}${sheen}${extra.front}${fx?.front ?? ''}</svg>`;
}
