// Portraits for dialog, shops and quest givers. A face can be a species id (capsule portrait), an
// image URL, or an NPC id. NPC ids resolve through registered resolvers (e.g. a rendered bust from
// the content/towns workstreams) and otherwise fall back to a stylised avatar drawn here.
import { SPECIES } from '../data/species';
import { esc, mysticFace } from './kit';

export type PortraitResolver = (npcId: string) => string | null | undefined;
const resolvers: PortraitResolver[] = [];
/** Plug in real NPC busts later: return an image URL for an NPC id, or null to fall through. */
export function registerPortraitResolver(fn: PortraitResolver) { resolvers.push(fn); }

const isUrl = (s: string) => /^(data:|blob:|https?:|\.{0,2}\/)/.test(s) || /\.(png|webp|jpe?g|svg|avif)(\?|$)/i.test(s);

export function faceHTML(face: string | undefined, name: string, size = 72, cls = '') {
  if (face && SPECIES[face]) return mysticFace(face, false, size, '', cls);
  const url = face ? (isUrl(face) ? face : resolvers.map((r) => r(face)).find(Boolean)) : null;
  if (url) return `<div class="cap npc ${cls}" style="--el:${roleColor(face ?? name)};--sz:${size}px"><img src="${esc(url)}" alt=""></div>`;
  return npcAvatar(face ?? name, name, size, cls);
}

// ── Stylised avatar ─────────────────────────────────────────────────────────
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const DOMES = ['#ff8a5c', '#5cb8ff', '#6fdc7c', '#e8b46a', '#ffd95c', '#7ff0dc', '#b99bff', '#ff7fae'];
const SKIN = ['#f6d2b4', '#e9b893', '#c98e64', '#9c6a45', '#6f4a33', '#f2c7a0'];
const CLOTH = ['#3f6fb8', '#b8484a', '#3f8f5a', '#7a4fb0', '#c58a2c', '#2f7f86', '#8a5a3c', '#50607a'];
const HAIR = ['#2b1d16', '#5a3a22', '#a8642e', '#e2c27a', '#d8d4cc', '#1c2430', '#8a3a2a'];

type Head = 'helmet' | 'hood' | 'cap' | 'spiky' | 'bun' | 'band' | 'wizard';
function headFor(id: string, name: string, h: number): Head {
  const s = `${id} ${name}`.toLowerCase();
  if (id === 'player') return 'wizard';
  if (/warden|guard|captain|knight|brisa/.test(s)) return 'helmet';
  if (/elder|maple|sage|scholar|priest|sister|mystic|oracle/.test(s)) return 'hood';
  if (/merchant|keeper|shop|trader|outfitter|miller|oru|tamsin|smith/.test(s)) return 'cap';
  if (/kai|rival|kid|scout/.test(s)) return 'spiky';
  return (['bun', 'band', 'spiky', 'cap'] as Head[])[h % 4];
}
export function roleColor(id: string) { return DOMES[hash(id) % DOMES.length]; }

export function npcAvatar(id: string, name: string, size = 72, cls = '') {
  const h = hash(id || name);
  const dome = DOMES[h % DOMES.length];
  const skin = SKIN[(h >>> 3) % SKIN.length];
  const cloth = CLOTH[(h >>> 6) % CLOTH.length];
  const hair = HAIR[(h >>> 9) % HAIR.length];
  const head = headFor(id, name, h >>> 12);
  const elder = /elder|maple|sage/.test(`${id} ${name}`.toLowerCase());
  const hw: Record<Head, string> = {
    helmet: `<path d="M24 44a26 26 0 0 1 52 0v4H24z" fill="#aab4c2" stroke="#06080c" stroke-width="2.5"/><path d="M50 18v30" stroke="#06080c" stroke-width="2.5"/><path d="M47 44h6v12h-6z" fill="#8894a4" stroke="#06080c" stroke-width="2"/><path d="M24 46h52" stroke="#06080c" stroke-width="2.5"/>`,
    hood: `<path d="M18 70c0-30 12-50 32-50s32 20 32 50c-6-4-10-14-10-26 0-10-10-16-22-16s-22 6-22 16c0 12-4 22-10 26z" fill="${cloth}" stroke="#06080c" stroke-width="2.5"/>${elder ? '<path d="M38 60c2 10 8 16 12 16s10-6 12-16c-6 3-18 3-24 0z" fill="#efeae0" stroke="#06080c" stroke-width="2"/>' : ''}`,
    cap: `<path d="M26 40c0-14 11-22 24-22s24 8 24 22z" fill="${cloth}" stroke="#06080c" stroke-width="2.5"/><path d="M22 40h56c2 0 2 5 0 5H22c-2 0-2-5 0-5z" fill="${cloth}" stroke="#06080c" stroke-width="2.5"/>`,
    spiky: `<path d="M26 44l-2-14 8 5 2-13 8 8 8-12 6 12 9-7 1 13 8-4-4 16z" fill="${hair}" stroke="#06080c" stroke-width="2.5" stroke-linejoin="round"/>`,
    bun: `<circle cx="50" cy="16" r="8" fill="${hair}" stroke="#06080c" stroke-width="2.5"/><path d="M26 46c0-16 10-24 24-24s24 8 24 24c-6-6-14-10-24-10s-18 4-24 10z" fill="${hair}" stroke="#06080c" stroke-width="2.5"/>`,
    wizard: `<path d="M22 44c10-4 46-4 56 0l-6 5c-10-3-34-3-44 0z" fill="#3b64c8" stroke="#06080c" stroke-width="2.5" stroke-linejoin="round"/><path d="M30 42c4-14 10-30 26-38-4 10-2 22 8 38z" fill="#4a78e0" stroke="#06080c" stroke-width="2.5" stroke-linejoin="round"/><path d="M31 38c10-2 24-2 32 0l1 5c-10-2-24-2-34 0z" fill="#ff9a3c" stroke="#06080c" stroke-width="2"/>`,
    band: `<path d="M26 46c0-16 10-24 24-24s24 8 24 24c-6-6-14-10-24-10s-18 4-24 10z" fill="${hair}" stroke="#06080c" stroke-width="2.5"/><path d="M26 38c14-5 34-5 48 0" stroke="${dome}" stroke-width="5" fill="none"/>`,
  };
  const svg = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M14 100c2-20 16-30 36-30s34 10 36 30z" fill="${cloth}" stroke="#06080c" stroke-width="2.5"/>
    <path d="M42 64h16v10c-4 3-12 3-16 0z" fill="${skin}" stroke="#06080c" stroke-width="2"/>
    <circle cx="50" cy="48" r="23" fill="${skin}" stroke="#06080c" stroke-width="2.5"/>
    <ellipse cx="41.5" cy="50" rx="3.2" ry="4" fill="#06080c"/><ellipse cx="58.5" cy="50" rx="3.2" ry="4" fill="#06080c"/>
    <circle cx="36" cy="58" r="3.4" fill="#ff8fa8" opacity=".55"/><circle cx="64" cy="58" r="3.4" fill="#ff8fa8" opacity=".55"/>
    <path d="M46 60q4 3 8 0" stroke="#06080c" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${hw[head]}
  </svg>`;
  return `<div class="cap npc avatar ${cls}" style="--el:${dome};--sz:${size}px" role="img" aria-label="${esc(name)}">${svg}</div>`;
}
