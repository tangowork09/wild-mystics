// Miscrits-style element wheel: two triangles of advantage.
// Fire > Nature > Water > Fire   |   Earth > Storm > Wind > Earth
// Void is the boss element: neutral to everything, deals slight bonus to all.

export type Element = 'fire' | 'water' | 'nature' | 'earth' | 'storm' | 'wind' | 'void';

export const ELEMENTS: Record<Element, { name: string; color: string; glyph: string }> = {
  fire: { name: 'Fire', color: '#ff6a3d', glyph: '🔥' },
  water: { name: 'Water', color: '#3da5ff', glyph: '💧' },
  nature: { name: 'Nature', color: '#5fd35a', glyph: '🌿' },
  earth: { name: 'Earth', color: '#c9964f', glyph: '⛰️' },
  storm: { name: 'Storm', color: '#f5d33d', glyph: '⚡' },
  wind: { name: 'Wind', color: '#9fe8e0', glyph: '🌪️' },
  void: { name: 'Void', color: '#b36bff', glyph: '✦' },
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
