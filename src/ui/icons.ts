import { ICON_PATHS, ICON_ALIAS } from './iconset';

/** Inline SVG icon (inherits text colour). Unknown names render a small diamond. */
export function icon(name: string, cls = ''): string {
  const d = ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIAS[name] ?? ''];
  if (!d) return `<svg class="ic ${cls}" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M256 40l216 216-216 216L40 256z"/></svg>`;
  return `<svg class="ic ${cls}" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}
