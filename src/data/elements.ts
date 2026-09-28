// Miscrits-style element wheel: two triangles of advantage.
// Fire > Nature > Water > Fire   |   Earth > Storm > Wind > Earth
// Void is the boss element: neutral to everything, deals slight bonus to all.

export type Element = 'fire' | 'water' | 'nature' | 'earth' | 'storm' | 'wind' | 'void';

// v3:ui — colours retuned to pop on the dark capsule-station UI (mirrored as --el-* tokens in ui/css/tokens.css).
export const ELEMENTS: Record<Element, { name: string; color: string; glyph: string }> = {
  fire: { name: 'Fire', color: '#ff6f3c', glyph: '🔥' },
  water: { name: 'Water', color: '#3aa8ff', glyph: '💧' },
  nature: { name: 'Nature', color: '#5ed66b', glyph: '🌿' },
  earth: { name: 'Earth', color: '#e0a45a', glyph: '⛰️' },
  storm: { name: 'Storm', color: '#ffd23f', glyph: '⚡' },
  wind: { name: 'Wind', color: '#6febd8', glyph: '🌪️' },
  void: { name: 'Void', color: '#a983ff', glyph: '✦' },
};

const BEATS: Partial<Record<Element, Element>> = {
  fire: 'nature',
  nature: 'water',
  water: 'fire',
  earth: 'storm',
  storm: 'wind',
  wind: 'earth',
};

/** Damage multiplier for an attack of `atk` element hitting a creature of `def` element. */
export function effectiveness(atk: Element, def: Element): number {
  if (atk === 'void') return 1.15;
  if (def === 'void') return 1;
  if (BEATS[atk] === def) return 1.5;
  if (BEATS[def] === atk) return 0.66;
  return 1;
}
