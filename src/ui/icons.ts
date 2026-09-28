import { ICON_PATHS, ICON_ALIAS } from './iconset';

const DIAMOND = 'M256 40l216 216-216 216L40 256z';
const pathOf = (name: string) => ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIAS[name] ?? ''];

/** Inline SVG icon from the game-icons set (inherits text colour). Unknown names render a small diamond. */
export function icon(name: string, cls = ''): string {
  return `<svg class="ic ${cls}" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="${pathOf(name) ?? DIAMOND}"/></svg>`;
}

// ── UI glyphs: authored for chrome (close, chevrons, steppers…) so no unicode stands in for an icon.
// Stroked glyphs share one weight (60/512); solid glyphs fill.
const STROKE: Record<string, string> = {
  close: 'M140 140L372 372M372 140L140 372',
  chevL: 'M314 112L170 256l144 144',
  chevR: 'M198 112l144 144-144 144',
  chevU: 'M112 318l144-144 144 144',
  chevD: 'M112 194l144 144 144-144',
  plus: 'M256 112v288M112 256h288',
  minus: 'M112 256h288',
  check: 'M110 272l94 94 198-218',
  arrow: 'M256 420V100M136 214L256 94l120 120',
  pause: 'M190 124v264M322 124v264',
  swap: 'M120 190h270l-72-72M392 322H122l72 72',
  locate: 'M256 150a106 106 0 1 0 0.1 0M256 56v70M256 386v70M56 256h70M386 256h70',
  rotate: 'M396 250a140 140 0 1 1-44-102M396 92v94h-94',
  back: 'M300 112L156 256l144 144M160 256h210',
  more: 'M150 256h.1M256 256h.1M362 256h.1',
  grid: 'M120 120h100v100H120zM292 120h100v100H292zM120 292h100v100H120zM292 292h100v100H292z',
  menu: 'M112 150h288M112 256h288M112 362h288',
  sort: 'M160 104v304M104 352l56 56 56-56M352 408V104M296 160l56-56 56 56',
  filter: 'M96 128h320L292 280v108l-72 36V280z',
  target: 'M256 118a138 138 0 1 0 0.1 0M256 206a50 50 0 1 0 0.1 0',
  steps: 'M140 150h232M140 256h232M140 362h160',
};
const SOLID: Record<string, string> = {
  star: 'M256 44l62 138 150 14-114 100 34 148-132-78-132 78 34-148L44 196l150-14z',
  diamond: 'M256 36l220 220-220 220L36 256z',
  pin: 'M256 470S88 300 88 196a168 168 0 0 1 336 0c0 104-168 274-168 274zm0-206a68 68 0 1 0 0-136 68 68 0 0 0 0 136z',
  play: 'M160 104l248 152-248 152z',
  skip: 'M96 112l176 144L96 400zM272 112l176 144-176 144z',
  dot: 'M256 176a80 80 0 1 0 0.1 0z',
  bang: 'M216 72h80l-14 250h-52zM256 356a44 44 0 1 1-.1 0z',
  query: 'M180 176a76 76 0 1 1 116 64c-26 18-40 34-40 64v18M256 380a40 40 0 1 1-.1 0z',
  heart: 'M256 440S72 330 72 196c0-66 50-112 108-112 34 0 62 18 76 44 14-26 42-44 76-44 58 0 108 46 108 112 0 134-184 244-184 244z',
  bolt: 'M292 40L120 292h116l-24 180 176-260H270z',
  caret: 'M256 150l150 190H106z',
};

export function glyph(name: string, cls = ''): string {
  const s = STROKE[name];
  if (s) return `<svg class="gl ${cls}" viewBox="0 0 512 512" aria-hidden="true"><path d="${s}"/></svg>`;
  return `<svg class="gl solid ${cls}" viewBox="0 0 512 512" aria-hidden="true"><path fill-rule="evenodd" d="${SOLID[name] ?? DIAMOND}"/></svg>`;
}

/** Draw an icon or glyph centred at (x, y) on a canvas, `size` px tall. */
const pathCache = new Map<string, { p: Path2D; stroke: boolean }>();
export function canvasIcon(c: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string) {
  let e = pathCache.get(name);
  if (!e) {
    const st = STROKE[name];
    e = st ? { p: new Path2D(st), stroke: true } : { p: new Path2D(SOLID[name] ?? pathOf(name) ?? DIAMOND), stroke: false };
    pathCache.set(name, e);
  }
  c.save();
  c.translate(x - size / 2, y - size / 2);
  c.scale(size / 512, size / 512);
  if (e.stroke) { c.strokeStyle = color; c.lineWidth = 70; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(e.p); }
  else { c.fillStyle = color; c.fill(e.p, 'evenodd'); }
  c.restore();
}
