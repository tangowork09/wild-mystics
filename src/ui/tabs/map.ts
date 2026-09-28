// World map: the painted island (or the relief fallback) under a fog of war, region names with
// lock state and level ranges, quest/POI pins and attuned fast-travel points. Drag to pan, wheel or
// pinch to zoom; nothing scrolls. The side card explains whatever is selected and offers Travel.
import { ZONES, WORLD_SIZE, type Zone } from '../../data/zones';
import { api, type Marker, type RegionView } from '../../game/contracts';
import { sfx } from '../../core/audio';
import { popover } from '../dom';
import { icon, glyph } from '../icons';
import { emptyState } from '../kit';
import { Pager } from '../pager';
import { allMarkers, trackedTarget, MARKER_STYLE, distText, bearingTo, cardinal } from '../guidance';
import { worldBase, fogLayer, onBaseChange } from '../worldbase';
import type { TravelPoint } from '../minimap';
import type { JournalHooks, TabCleanup } from '../journal';

type Sel = { t: 'travel'; p: TravelPoint } | { t: 'marker'; m: Marker } | { t: 'region'; z: Zone } | null;
const TRAVEL_IC: Record<TravelPoint['kind'], string> = { town: 'house_base', camp: 'campfire', waystone: 'waypoint_obelisk', homestead: 'hammer_build' };

const view0 = { zoom: 1, cx: 0, cz: 40 };

export function renderMap(root: HTMLElement, hooks: JournalHooks, close: () => void): TabCleanup {
  const mm = hooks.minimap();
  const world = mm.world;
  const travel = mm.travelPoints();
  const block = hooks.travelBlock();
  let regions: RegionView[] = [];
  try { regions = api.world.regions(); } catch { regions = []; }
  const regionOf = (id: string) => regions.find((r) => r.id === id);
  const markers = allMarkers().filter((m) => !(['town', 'waystone', 'camp', 'homestead'].includes(m.kind) && travel.some((p) => Math.hypot(p.x - m.x, p.z - m.z) < 24)));
  const tracked = trackedTarget();

  root.innerHTML = `<div class="wmap">
    <div class="wm-view" tabindex="0" aria-label="World map. Drag to pan, scroll or pinch to zoom.">
      <canvas class="wm-canvas"></canvas>
      <div class="wm-regions"></div><div class="wm-pins"></div>
      <div class="wm-ctl">
        <button class="wm-b" data-z="in" aria-label="Zoom in">${glyph('plus')}</button>
        <button class="wm-b" data-z="out" aria-label="Zoom out">${glyph('minus')}</button>
        <button class="wm-b" data-z="me" aria-label="Centre on you">${glyph('locate')}</button>
        ${tracked ? `<button class="wm-b goal" data-z="goal" aria-label="Centre on your objective">${glyph('diamond')}</button>` : ''}
        <button class="wm-b" data-z="key" aria-label="Map legend">${glyph('query')}</button>
      </div>
    </div>
    <aside class="wm-side"><div class="wm-info"></div><section class="sec grow wm-travel"><header class="sec-h"><b>Fast travel</b><span class="sec-n">${travel.length}</span></header><div class="wm-tl"></div></section></aside>
  </div>`;
  const viewEl = root.querySelector('.wm-view') as HTMLElement;
  const cv = root.querySelector('.wm-canvas') as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  const regEl = root.querySelector('.wm-regions') as HTMLElement;
  const pinEl = root.querySelector('.wm-pins') as HTMLElement;
  const info = root.querySelector('.wm-info') as HTMLElement;
  let W = 0, H = 0, dpr = 1;
  let { zoom, cx, cz } = view0;
  let sel: Sel = tracked ? { t: 'marker', m: tracked.marker } : { t: 'region', z: world.zone };

  // ── DOM pins (created once, positioned on every draw) ──
  regEl.innerHTML = ZONES.map((z) => {
    const r = regionOf(z.id);
    const locked = r ? !r.unlocked : false;
    const known = r ? r.visited || r.unlocked : true;
    return `<button class="wm-rg ${locked ? 'locked' : ''} ${r?.guardianDefeated ? 'cleared' : ''} ${r && !r.visited ? 'unvisited' : ''}" data-rg="${z.id}" aria-label="${z.name}, levels ${z.levels[0]} to ${z.levels[1]}${locked ? ', locked' : ''}">
      <span class="rg-n">${locked ? icon('lock') : ''}${known ? z.name : '???'}</span><span class="rg-l tnum">Lv ${z.levels[0]}–${z.levels[1]}${r?.guardianDefeated ? ` · ${icon('trophy')}` : ''}</span></button>`;
  }).join('');
  const pins: { el: HTMLElement; x: number; z: number }[] = [];
  const addPin = (x: number, z: number, cls: string, html: string, label: string, onPick: () => void) => {
    const b = document.createElement('button');
    b.className = `wm-pin ${cls}`;
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); return; } onPick(); });
    pinEl.appendChild(b);
    pins.push({ el: b, x, z });
    return b;
  };
  for (const m of markers) {
    if (tracked && m.id === tracked.marker.id && m.kind === tracked.marker.kind) continue;
    const st = MARKER_STYLE[m.kind];
    addPin(m.x, m.z, `mk k-${m.kind}`, `<span class="pin-dot" style="--c:${st.color}">${st.glyph ? glyph(st.icon) : icon(st.icon)}</span>`, `${m.label} (${st.label})`, () => select({ t: 'marker', m }));
  }
  for (const p of travel) addPin(p.x, p.z, `tp k-${p.kind}`, `<span class="pin-dot">${icon(TRAVEL_IC[p.kind])}</span>`, `${p.label}: fast travel`, () => select({ t: 'travel', p }));
  if (tracked) {
    const st = MARKER_STYLE[tracked.marker.kind];
    addPin(tracked.marker.x, tracked.marker.z, 'goal', `<span class="pin-dot" style="--c:${st.color}">${glyph('diamond')}</span><span class="pin-l">${tracked.marker.label}</span>`, `${tracked.marker.label} (tracked objective)`, () => select({ t: 'marker', m: tracked.marker }));
  }
  const me = addPin(world.playerPos.x, world.playerPos.z, 'me', `<span class="me-arrow" style="transform:rotate(${(-world.player.root.rotation.y * 180) / Math.PI + 180}deg)">${glyph('arrow')}</span>`, 'You are here', () => select({ t: 'region', z: world.zone }));
  me.tabIndex = -1;
  regEl.querySelectorAll<HTMLElement>('[data-rg]').forEach((b) => b.addEventListener('click', () => { if (!dragged) select({ t: 'region', z: ZONES.find((z) => z.id === b.dataset.rg)! }); }));

  // ── drawing ──
  const k = () => (zoom * Math.min(W, H)) / 1960;
  const toScreen = (x: number, z: number): [number, number] => [(x - cx) * k() + W / 2, (z - cz) * k() + H / 2];
  const fit = () => {
    const w = viewEl.clientWidth, h = viewEl.clientHeight;
    const d = Math.min(2, devicePixelRatio || 1);
    if (w !== W || h !== H || d !== dpr) {
      W = w; H = h; dpr = d;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
  };
  const draw = () => {
    fit();
    if (!W || !H) return;
    const s = k();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f3550';
    ctx.fillRect(0, 0, W, H);
    const [x0, y0] = toScreen(-WORLD_SIZE / 2, -WORLD_SIZE / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(worldBase(world), x0, y0, WORLD_SIZE * s, WORLD_SIZE * s);
    const fog = fogLayer();
    if (fog) ctx.drawImage(fog, x0, y0, WORLD_SIZE * s, WORLD_SIZE * s);
    for (const p of pins) {
      const [x, y] = toScreen(p.x, p.z);
      const vis = x > -30 && y > -30 && x < W + 30 && y < H + 30;
      p.el.style.display = vis ? '' : 'none';
      if (vis) p.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    }
    regEl.querySelectorAll<HTMLElement>('[data-rg]').forEach((b) => {
      const z = ZONES.find((zz) => zz.id === b.dataset.rg)!;
      const [x, y] = toScreen(z.center[0], z.center[1] - (z.id === 'summit' ? 60 : 0));
      b.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;
      b.style.display = x > -120 && y > -40 && x < W + 120 && y < H + 40 ? '' : 'none';
    });
    root.querySelector('.wmap')!.classList.toggle('zoomed', zoom > 1.9);
  };
  const clampView = () => {
    zoom = Math.max(1, Math.min(5, zoom));
    const lim = WORLD_SIZE / 2 - Math.min(W, H) / (2 * k());
    const L = Math.max(0, lim);
    cx = Math.max(-L, Math.min(L, cx));
    cz = Math.max(-L, Math.min(L, cz));
  };
  const zoomAt = (f: number, sx = W / 2, sy = H / 2) => {
    const wx = (sx - W / 2) / k() + cx, wz = (sy - H / 2) / k() + cz;
    zoom *= f;
    clampView();
    cx = wx - (sx - W / 2) / k();
    cz = wz - (sy - H / 2) / k();
    clampView();
    draw();
  };
  const centre = (x: number, z: number, minZoom = 2.2) => { zoom = Math.max(zoom, minZoom); cx = x; cz = z; clampView(); draw(); };

  // ── pan / pinch / wheel ──
  const ptrs = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let start: { x: number; y: number; cx: number; cz: number } | null = null;
  let pinch: { d: number; zoom: number } | null = null;
  viewEl.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.wm-ctl')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    if (ptrs.size === 1) start = { x: e.clientX, y: e.clientY, cx, cz };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom }; }
  });
  viewEl.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = viewEl.getBoundingClientRect();
      const f = (pinch.zoom * d) / pinch.d / zoom;
      dragged = true;
      zoomAt(f, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) > 6) { dragged = true; viewEl.setPointerCapture(e.pointerId); viewEl.classList.add('grab'); }
      if (dragged) { cx = start.cx - dx / k(); cz = start.cz - dy / k(); clampView(); draw(); }
    }
  });
  const up = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) { start = null; viewEl.classList.remove('grab'); setTimeout(() => (dragged = false), 0); }
  };
  viewEl.addEventListener('pointerup', up);
  viewEl.addEventListener('pointercancel', up);
  viewEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewEl.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  viewEl.addEventListener('keydown', (e) => {
    const step = 60 / k();
    const map: Record<string, () => void> = {
      ArrowLeft: () => (cx -= step), ArrowRight: () => (cx += step), ArrowUp: () => (cz -= step), ArrowDown: () => (cz += step),
      '+': () => (zoom *= 1.25), '=': () => (zoom *= 1.25), '-': () => (zoom /= 1.25),
    };
    const f = map[e.key];
    if (!f) return;
    f();
    clampView();
    draw();
    e.preventDefault();
    e.stopPropagation();
  });
  root.querySelectorAll<HTMLElement>('[data-z]').forEach((b) => b.addEventListener('click', async () => {
    const z = b.dataset.z;
    if (z === 'in') zoomAt(1.4);
    if (z === 'out') zoomAt(1 / 1.4);
    if (z === 'me') { centre(world.playerPos.x, world.playerPos.z); select({ t: 'region', z: world.zone }); }
    if (z === 'goal' && tracked) { centre(tracked.marker.x, tracked.marker.z); select({ t: 'marker', m: tracked.marker }); }
    if (z === 'key') {
      const kinds = [...new Set([...markers.map((m) => m.kind), ...(tracked ? [tracked.marker.kind] : [])])];
      await popover(b, [
        { value: 'you', label: 'You', icon: `<span class="lg-dot me">${glyph('arrow')}</span>` },
        ...travel.slice(0, 1).map(() => ({ value: 'travel', label: 'Fast travel point', icon: `<span class="lg-dot tp">${icon('waypoint_obelisk')}</span>` })),
        ...kinds.map((kd) => ({ value: kd as string, label: MARKER_STYLE[kd].label, icon: `<span class="lg-dot" style="--c:${MARKER_STYLE[kd].color}">${MARKER_STYLE[kd].glyph ? glyph(MARKER_STYLE[kd].icon) : icon(MARKER_STYLE[kd].icon)}</span>` })),
      ], { title: 'Legend', cols: kinds.length > 6 ? 2 : 1 });
    }
  }));

  // ── side card ──
  const go = (p: TravelPoint) => {
    if (block) { sfx('error'); return; }
    close();
    hooks.travel(p);
  };
  const select = (s: Sel) => {
    sel = s;
    sfx('select');
    pins.forEach((p) => p.el.classList.remove('sel'));
    drawInfo();
  };
  const drawInfo = () => {
    const px = world.playerPos.x, pz = world.playerPos.z;
    const where = (x: number, z: number) => { const d = Math.hypot(x - px, z - pz); return d < 8 ? 'You are here' : `${distText(d)} ${cardinal(bearingTo(px, pz, x, z))}`; };
    if (sel?.t === 'travel') {
      const p = sel.p;
      const z = ZONES.find((zz) => zz.id === p.zone);
      info.innerHTML = `<div class="wi"><div class="wi-h"><span class="wi-ic tp">${icon(TRAVEL_IC[p.kind])}</span><div><b>${p.label}</b><small>${z?.name ?? ''} · ${where(p.x, p.z)}</small></div></div>
        ${block ? `<p class="wi-warn">${icon('lock')} ${block}</p>` : '<p class="muted">Attuned. You can travel here instantly.</p>'}
        <button class="btn primary wide" data-go ${block ? 'disabled' : ''}>${glyph('play')} Travel here</button></div>`;
      info.querySelector('[data-go]')?.addEventListener('click', () => go(p));
    } else if (sel?.t === 'marker') {
      const m = sel.m;
      const st = MARKER_STYLE[m.kind];
      const isGoal = tracked && tracked.marker.id === m.id;
      const q = isGoal ? tracked!.quest : null;
      info.innerHTML = `<div class="wi"><div class="wi-h"><span class="wi-ic" style="--c:${st.color}">${st.glyph ? glyph(st.icon) : icon(st.icon)}</span><div><b>${m.label}</b><small>${isGoal ? 'Tracked objective' : st.label} · ${where(m.x, m.z)}</small></div></div>
        ${q ? `<p class="wi-q"><b>${q.title}</b>${q.current ? ` · ${q.current.text}` : ''}</p>` : ''}
        ${nearestTravel(m.x, m.z)}</div>`;
      info.querySelector('[data-go]')?.addEventListener('click', () => { const p = travel.find((t) => t.id === (info.querySelector('[data-go]') as HTMLElement).dataset.go); if (p) go(p); });
    } else {
      const z = sel?.z ?? world.zone;
      const r = regionOf(z.id);
      const here = world.zone.id === z.id;
      info.innerHTML = `<div class="wi"><div class="wi-h"><span class="wi-ic rg ${r && !r.unlocked ? 'locked' : ''}">${icon(r && !r.unlocked ? 'lock' : 'map')}</span><div><b>${r && !r.visited && !r.unlocked ? 'Uncharted land' : z.name}</b><small>Lv ${z.levels[0]}–${z.levels[1]}${here ? ' · You are here' : ''}${r?.guardianDefeated ? ' · Guardian answered' : ''}</small></div></div>
        <p class="muted wi-p">${r && !r.unlocked ? r.lockHint ?? 'A Warden Gate seals this land.' : z.subtitle}.</p>
        ${travel.some((t) => t.kind === 'homestead') ? `<button class="btn ghost wide" data-home ${block ? 'disabled' : ''}>${icon('hammer_build')} Travel home</button>` : ''}</div>`;
      info.querySelector('[data-home]')?.addEventListener('click', () => { const p = travel.find((t) => t.kind === 'homestead'); if (p) go(p); });
    }
  };
  const nearestTravel = (x: number, z: number) => {
    const p = [...travel].filter((t) => t.kind !== 'homestead').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (!p) return '';
    return `<button class="btn ghost wide" data-go="${p.id}" ${block ? 'disabled' : ''}>${icon(TRAVEL_IC[p.kind])} Travel to ${p.label}<small>${distText(Math.hypot(p.x - x, p.z - z))} away</small></button>`;
  };

  const tl = new Pager<TravelPoint>(root.querySelector('.wm-tl') as HTMLElement, {
    items: travel, cell: { w: 180, h: 40 }, gap: 4, maxCols: 1, label: 'Fast travel points',
    selected: (p) => sel?.t === 'travel' && sel.p.id === p.id,
    onPick: (p) => { select({ t: 'travel', p }); centre(p.x, p.z, zoom); tl.refresh(); },
    render: (p) => `<span class="tl-row"><span class="tl-ic">${icon(TRAVEL_IC[p.kind])}</span><b class="ell">${p.label}</b></span>`,
    empty: emptyState('Nothing attuned yet', 'Touch a Waystone to attune it.', 'waypoint_obelisk'),
  });

  const ro = new ResizeObserver(() => { clampView(); draw(); });
  ro.observe(viewEl);
  const off = onBaseChange(draw);
  drawInfo();
  requestAnimationFrame(() => { fit(); clampView(); draw(); });
  return () => { view0.zoom = zoom; view0.cx = cx; view0.cz = cz; ro.disconnect(); off(); tl.destroy(); };
}
