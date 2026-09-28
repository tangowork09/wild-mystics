// Gold ornaments shared by the ornate UI (confirm modal, dialog box): one hidden <svg> of gradients,
// the compass star + violet gem, crest wings, frame corners, compass watermark and small glyphs.
// Shared gradients live in one hidden <svg> so every ornament can reference them.
export function ensureOrnamentDefs() {
  if (document.getElementById('rt-defs')) return;
  const d = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  d.id = 'rt-defs';
  d.setAttribute('aria-hidden', 'true');
  d.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  d.innerHTML = `<defs>
    <linearGradient id="rt-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4cc"/><stop offset=".42" stop-color="#f1cb72"/><stop offset=".78" stop-color="#c38b30"/><stop offset="1" stop-color="#7d4d15"/></linearGradient>
    <linearGradient id="rt-gold-d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9a54a"/><stop offset="1" stop-color="#6e420f"/></linearGradient>
    <radialGradient id="rt-gem" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#f6e6ff"/><stop offset=".3" stop-color="#c08cff"/><stop offset=".68" stop-color="#7133d6"/><stop offset="1" stop-color="#2d0d68"/></radialGradient>
    <filter id="rt-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
  document.body.appendChild(d);
}

// 8-point compass star with a violet gem; the crest's centre and the faint watermark share it.
const K = (pts: string, fill: string) => `<polygon points="${pts}" fill="${fill}"/>`;
export const STAR = [
  // diagonal short points (behind)
  K('171.2,40.8 153.5,51.4 150,62', '#e9bd63'), K('171.2,40.8 160.6,58.5 150,62', '#8e5c1d'),
  K('171.2,83.2 160.6,65.5 150,62', '#e9bd63'), K('171.2,83.2 153.5,72.6 150,62', '#8e5c1d'),
  K('128.8,83.2 146.5,72.6 150,62', '#e9bd63'), K('128.8,83.2 139.4,65.5 150,62', '#8e5c1d'),
  K('128.8,40.8 139.4,58.5 150,62', '#e9bd63'), K('128.8,40.8 146.5,51.4 150,62', '#8e5c1d'),
  // long points: the clockwise half of each is in shade (pinwheel bevel)
  K('150,4 142,54 150,62', 'url(#rt-gold)'), K('150,4 158,54 150,62', 'url(#rt-gold-d)'),
  K('196,62 158,54 150,62', 'url(#rt-gold)'), K('196,62 158,70 150,62', 'url(#rt-gold-d)'),
  K('150,120 158,70 150,62', 'url(#rt-gold)'), K('150,120 142,70 150,62', 'url(#rt-gold-d)'),
  K('104,62 142,70 150,62', 'url(#rt-gold)'), K('104,62 142,54 150,62', 'url(#rt-gold-d)'),
].join('');
const WING = `<g fill="none" stroke="url(#rt-gold)" stroke-linecap="round" stroke-width="3">
    <path d="M112 57C100 44 84 40 70 44C58 48 54 58 44 58C36 58 32 52 34 47C36 42 43 42 44 47"/>
    <path d="M108 66C94 71 80 69 64 65C48 61 30 60 8 62" stroke-width="2.4"/>
    <path d="M92 47C88 38 80 33 71 32" stroke-width="1.8"/>
  </g>
  <path d="M84 45C79 36 69 33 61 37C69 41 77 45 84 45Z" fill="url(#rt-gold)"/>
  <circle cx="8" cy="62" r="3.2" fill="url(#rt-gold)"/>`;
export const CREST = `<svg class="rt-crest" viewBox="0 0 300 124" aria-hidden="true">
  <circle cx="150" cy="62" r="34" fill="none" stroke="#e8c77a" stroke-opacity=".55" stroke-width="1.2"/>
  ${WING}<g transform="translate(300 0) scale(-1 1)">${WING}</g>
  <circle cx="150" cy="62" r="25" fill="#1b1128" stroke="url(#rt-gold)" stroke-width="2.6"/>
  ${STAR}
  <circle class="rt-glow" cx="150" cy="62" r="15" fill="#a66bff" filter="url(#rt-blur)"/>
  <polygon points="150,46 161,62 150,78 139,62" fill="url(#rt-gem)" stroke="#2a0c5e" stroke-width="1.2"/>
  <polygon points="150,46 139,62 150,62" fill="#fff" fill-opacity=".3"/>
  <polygon points="150,46 161,62 150,62" fill="#fff" fill-opacity=".1"/>
  <polygon points="139,62 150,78 150,62" fill="#12002e" fill-opacity=".25"/>
  <ellipse cx="146" cy="54" rx="2.6" ry="1.6" fill="#fff" fill-opacity=".9"/>
</svg>`;
export const CORNER = `<svg class="rt-corner" viewBox="0 0 100 100" aria-hidden="true">
  <g fill="none" stroke="url(#rt-gold)" stroke-linecap="round">
    <path d="M13 86V40C13 25 25 13 40 13H86" stroke-width="3.4"/>
    <path d="M21 70V42C21 30 30 21 42 21H70" stroke-width="1.2" stroke-opacity=".7"/>
    <path d="M20 20C12 12 5 5 11 3C17 1 20 8 15 10.5C11 12 8.5 8.5 11.5 7" stroke-width="2.6"/>
    <path d="M24 16C27 8 34 5 40 6" stroke-width="1.6"/><path d="M16 24C8 27 5 34 6 40" stroke-width="1.6"/>
  </g>
  <path d="M46 13C52 5 62 3 69 7C61 9 53 11 46 13Z" fill="url(#rt-gold)"/>
  <path d="M13 46C5 52 3 62 7 69C9 61 11 53 13 46Z" fill="url(#rt-gold)"/>
  <path d="M86 9.5 90 13 86 16.5 82 13Z" fill="url(#rt-gold)"/><path d="M9.5 86 13 90 16.5 86 13 82Z" fill="url(#rt-gold)"/>
  <circle cx="28" cy="28" r="2.2" fill="url(#rt-gold)"/>
</svg>`;
export const MARK = `<svg class="rt-mark" viewBox="0 0 300 124" aria-hidden="true"><g fill="none" stroke="#e3c27c" stroke-width=".8">
  <circle cx="150" cy="62" r="56"/><circle cx="150" cy="62" r="44"/><circle cx="150" cy="62" r="20"/>
  <path d="M150 0V124M88 62H212M106 18L194 106M194 18L106 106"/></g></svg>`;
export const WARN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 22.6 21H1.4Z" fill="#ff6a4d" stroke="#ff6a4d" stroke-width="1.6" stroke-linejoin="round"/><rect x="10.9" y="9" width="2.2" height="6.8" rx="1.1" fill="#2a0909"/><circle cx="12" cy="18.3" r="1.3" fill="#2a0909"/></svg>';
export const SPARK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 0 11.8 8.2 20 10 11.8 11.8 10 20 8.2 11.8 0 10 8.2 8.2Z" fill="url(#rt-gold)"/></svg>';

/** The four frame corners (top-left art mirrored into place by CSS). */
export const CORNERS = ['c-tl', 'c-tr', 'c-bl', 'c-br'].map((c) => CORNER.replace('rt-corner', `rt-corner ${c}`)).join('');

/** Speaker medallion: heraldic banner behind a gold ring, compass crest on top (portrait sits in the ring). */
export const MEDAL = `<svg class="dg-medal-art" viewBox="0 0 200 290" aria-hidden="true">
  <defs><linearGradient id="dg-cloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f4f9a"/><stop offset=".55" stop-color="#203b7c"/><stop offset="1" stop-color="#15295a"/></linearGradient></defs>
  <path d="M40 58H160V246L100 284L40 246Z" fill="url(#dg-cloth)" stroke="url(#rt-gold)" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M49 66H151V240L100 272L49 240Z" fill="none" stroke="#e3c27c" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M22 132L40 122V206L22 218Z" fill="url(#dg-cloth)" stroke="url(#rt-gold)" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M178 132L160 122V206L178 218Z" fill="url(#dg-cloth)" stroke="url(#rt-gold)" stroke-width="2.4" stroke-linejoin="round"/>
  <g transform="translate(100 254) scale(.2) translate(-150 -62)">${STAR}</g>
  <circle cx="100" cy="140" r="80" fill="#121a33" stroke="url(#rt-gold)" stroke-width="8"/>
  <circle cx="100" cy="140" r="72.5" fill="none" stroke="#5c3a0e" stroke-width="1.5"/>
  <circle cx="100" cy="140" r="86" fill="none" stroke="#e3c27c" stroke-opacity=".5" stroke-width="1"/>
  <g transform="translate(100 46) scale(.62) translate(-150 -62)">${STAR}<polygon points="150,46 161,62 150,78 139,62" fill="url(#rt-gem)" stroke="#2a0c5e" stroke-width="1.2"/></g>
</svg>`;
