// Hearthwick — the hub (Verdant Vale). Cosy half-timbered market town: cream plaster, dark oak,
// terracotta and moss-green roofs, fieldstone walls and hedges, a tiered fountain on a cobbled
// plaza and the Wishing Spire on axis with Mount Aether. Arrive through the South Gate
// (START_POS sits just outside it), walk the main street north past the bakery to the fountain.
//
// Local frame = world orientation (+Z south, +X east), origin at the fountain.

import type { TownCtx, P2 } from '../town';
import { circle } from '../town';
import { house, toTown, type HouseSpec } from '../houses';
import type { Palette } from '../arch';
import { lamp, bench, fence, fountain, questBoard, stall, tree, flowers, planter, banner, goods, kit, woodpile, hay, signpost } from '../parts';
import { wishingSpire, rotunda, gateArch, observatory } from '../monuments';
import { shade } from '../kit';

const PLASTER = ['#efe4cf', '#f1dcc2', '#e9e2d0', '#e4e6d6', '#f3e6d0'];
const ROOFS = ['#b55a3c', '#8e4a36', '#6d7a4c', '#9a5a3e', '#5d6672'];
const DOORS = ['#6a3f2a', '#2f5a4a', '#3a4f7a', '#8a3a2a', '#5a4a6a'];
const SHUTTERS = ['#4a7a5a', '#3f6a8a', '#a04a3a', '#7a6a3a', '#5a5a7a'];
const TIMBER = '#4b3527';
const STONE = '#9d9384';

const pal = (i: number, over: Partial<Palette> = {}): Palette => ({
  wall: PLASTER[i % PLASTER.length], wall2: PLASTER[(i + 2) % PLASTER.length], base: STONE, trim: '#e9dcc4', timber: TIMBER,
  roof: ROOFS[i % ROOFS.length], door: DOORS[i % DOORS.length], shutter: SHUTTERS[(i + 1) % SHUTTERS.length],
  flowers: ['#e2476a', '#f08aa8', '#ffd24a', '#ffffff'], ...over,
});

/** A cottage with a little front garden and picket fence, facing `rot`. */
function cottage(ctx: TownCtx, x: number, z: number, rot: number, i: number, over: Partial<HouseSpec> = {}) {
  const r = ctx.rnd;
  const w = over.w ?? 7 + Math.round(r() * 2);
  const d = over.d ?? 6 + Math.round(r() * 1.5);
  const two = over.floors ?? (r() < 0.7 ? 2 : 1);
  const spec: HouseSpec = {
    w, d, floors: two, ground: r() < 0.4 ? 'stone' : 'plaster', upper: 'timber', jetty: two > 1 ? 0.35 : 0,
    pal: pal(i), rise: (Math.min(w, d) / 2) * (1.05 + r() * 0.35), chimney: r() < 0.5 ? 1 : -1,
    win: { flowers: r() < 0.7 }, door: { canopy: r() < 0.5 ? ROOFS[(i + 1) % ROOFS.length] : null },
    gableFront: r() < 0.25, ...over,
  };
  const m = house(ctx, x, z, rot, spec);
  // front garden with a picket fence and a gate gap in front of the door
  const gd = 2.2;
  const hw = w / 2 + 0.2;
  const toL = (px: number, pz: number) => toTown(x, z, rot, px, pz);
  const dz = d / 2 + gd;
  const doorX = spec.door && spec.door.x !== undefined ? spec.door.x : w >= 6 ? -w * 0.18 : 0;
  fence(ctx, [toL(-hw, d / 2 + 0.2), toL(-hw, dz), toL(doorX - 0.75, dz)], 'picket');
  fence(ctx, [toL(doorX + 0.75, dz), toL(hw, dz), toL(hw, d / 2 + 0.2)], 'picket');
  const [fx1, fz1] = toL(-hw / 2 - 0.4, d / 2 + gd / 2 + 0.2);
  const [fx2, fz2] = toL(hw / 2 + 0.6, d / 2 + gd / 2 + 0.2);
  flowers(ctx, fx1, fz1, 0.9, ['#e2476a', '#ffd24a', '#b58aff'], 7);
  flowers(ctx, fx2, fz2, 0.9, ['#f08aa8', '#ffffff', '#ffd24a'], 7);
  return m;
}

export function buildHearthwick(ctx: TownCtx) {
  const r = ctx.rnd;
  const cobble = '#e2d6c0', street = '#d6c7aa', curb = '#8f877c';

  // ── ground: plaza, spire forecourt, four streets ───────────────────────────────────────
  ctx.fill(circle(0, 0, 16.5, 44), (x, z) => shade(cobble, 1 - 0.06 * Math.max(0, 1 - Math.hypot(x, z) / 5)), { curb });
  ctx.fill(circle(0, -22.5, 6.8, 28), cobble, { curb, lift: 0.1 });
  ctx.street([[0, 16], [0, 50], [0, 67]], 6, street, { curb });
  ctx.street([[16, 0.5], [34, 0.2], [53, -0.5]], 5.5, street, { curb });
  ctx.street([[-16, 0.5], [-34, 0.2], [-53, -0.5]], 5.5, street, { curb });
  ctx.street([[0, -29], [0.5, -40], [0, -54]], 5, street, { curb });
  // side lanes (narrow, no curbs)
  ctx.street([[-3, 28], [-26, 30], [-34, 36]], 2.4, shade(street, 0.94), { curb: null });
  ctx.street([[3, 30], [24, 30], [32, 36]], 2.4, shade(street, 0.94), { curb: null });

  // ── plaza centrepiece ──────────────────────────────────────────────────────────────────
  fountain(ctx, 0, 0, { stone: '#bdb3a2' });
  for (const a of [45, 135, 225, 315]) {
    const rad = (a * Math.PI) / 180;
    const bx = Math.cos(rad) * 7.2, bz = Math.sin(rad) * 7.2;
    bench(ctx, bx, bz, ctx.face(bx, bz, 0, 0) + Math.PI);
  }
  for (const a of [0, 90, 180, 270]) {
    const rad = (a * Math.PI) / 180 + Math.PI / 4;
    planter(ctx, Math.cos(rad + 0.38) * 5.6, Math.sin(rad + 0.38) * 5.6, rad + 0.38 + Math.PI / 2, 1.6, 0.8, { stone: '#a89e8e' });
  }
  for (const a of [22, 68, 112, 158, 202, 248, 292, 338]) {
    const rad = (a * Math.PI) / 180;
    lamp(ctx, Math.cos(rad) * 14.8, Math.sin(rad) * 14.8, 'iron');
  }
  wishingSpire(ctx, 0, -22.5, 0);
  ctx.service('summon', 0, -18.6, 'Wishing Spire — Summon', undefined, 4);
  ctx.anchor('summon', 0, -18.2, 0);
  tree(ctx, -10.5, -21, 'blossom', 0.95);
  tree(ctx, 10.5, -21, 'blossom', 0.9);
  flowers(ctx, -7.8, -26, 1.2, ['#f08aa8', '#ffffff', '#ffd24a'], 9);
  flowers(ctx, 7.8, -26, 1.2, ['#e2476a', '#b58aff', '#ffffff'], 9);

  // ── plaza-facing civic buildings ───────────────────────────────────────────────────────
  const at = (deg: number, R: number): [number, number, number] => {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    return [x, z, Math.atan2(-x, -z)];
  };
  // Sanctuary (healer) — NW
  {
    const [x, z, rot] = at(220, 22.5);
    const m = house(ctx, x, z, rot, {
      w: 10.5, d: 7.5, floors: 2, gh: 3.2, fh: 2.8, ground: 'stone', upper: 'timber', jetty: 0.3,
      pal: pal(0, { roof: '#a8424e', wall2: '#f3e8da', door: '#7a2e36', shutter: '#b8505e', flowers: ['#ff5a7a', '#ffffff', '#ffb0c0'] }),
      rise: 3.9, chimney: -1, door: { x: 0, double: true, arch: true, lamp: true }, porch: { depth: 2.2, roof: true },
      win: { flowers: true }, sign: { text: 'Sanctuary', sub: 'Healer · Rest & restore', icon: '✚', bg: '#5a1e26', accent: '#f0b8c0' },
    });
    // little bell cote astride the ridge
    const [rx, rz] = m.to(1.6, 0);
    ctx.b.push().translate(rx, m.wallTop + 3.6, rz).rotY(rot);
    for (const [px, pz] of [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]]) ctx.b.box('solid', px, 0.55, pz, 0.14, 1.1, 0.14, TIMBER);
    ctx.b.box('solid', 0, 0.05, 0, 1.2, 0.14, 1.2, TIMBER);
    ctx.b.cone('solid', 0, 1.1, 0, 0.95, 0.9, '#a8424e', { sides: 4, ry: Math.PI / 4 });
    ctx.b.lathe('metal', 0, 0.35, 0, [[0.05, 0.55], [0.18, 0.5], [0.22, 0.2], [0.3, 0.0], [0, 0]], '#c9a24a', { sides: 10 });
    ctx.b.pop();
    ctx.service('healer', m.door[0], m.door[1], 'Sanctuary — Healer', undefined, 3.4);
    ctx.anchor('healer', ...m.door, m.yaw);
    const [px, pz] = m.to(-6.6, 3.6);
    planter(ctx, px, pz, rot, 1.2, 1.2, { colors: ['#ff5a7a', '#ffffff'] });
  }
  // Outfitter — NE
  {
    const [x, z, rot] = at(320, 22.5);
    const m = house(ctx, x, z, rot, {
      w: 10, d: 7, floors: 2, gh: 3.2, ground: 'plaster', upper: 'timber', jetty: 0.35,
      pal: pal(2, { roof: '#4a6a92', door: '#2f4f7a', shutter: '#3f6a8a' }),
      rise: 3.6, chimney: 1, door: { x: 0 }, shopfront: { awning: ['#3a6ac0', '#f4efe2'] },
      sign: { text: 'Outfitter', sub: 'Orbs · Tonics · Gear', icon: '◈', bg: '#1e2e4a', accent: '#9ec0f0' }, bracket: { icon: '◈', bg: '#1e2e4a' },
    });
    ctx.service('shop', m.door[0], m.door[1], 'Hearthwick Outfitter', 'hearthwick_outfitter', 3.4);
    ctx.anchor('shopCounter', ...m.door, m.yaw + Math.PI);
    const [gx, gz] = m.to(6.4, 2.6);
    goods(ctx, gx, gz, rot, r, 4);
  }
  // Bramble's Bakery (specialty) — SW, with a bread stall out front
  {
    const [x, z, rot] = at(140, 22.5);
    const m = house(ctx, x, z, rot, {
      w: 9, d: 7, floors: 2, gh: 3.1, ground: 'plaster', upper: 'timber', jetty: 0.35,
      pal: pal(1, { wall: '#f6dfb8', roof: '#b8643a', door: '#8a4a2a', shutter: '#c07a3a' }),
      rise: 3.5, chimney: 1, door: { x: -1.6 }, shopfront: { awning: ['#e0843a', '#fbf1dc'] },
      sign: { text: 'Bramble’s Bakery', sub: 'Honey cakes & berry treats', icon: '❀', bg: '#5a2e14', accent: '#f4c27a' },
    });
    const [sx, sz] = m.to(2.4, 5.9);
    stall(ctx, sx, sz, rot, ['#e0843a', '#fbf1dc'], 'bread', { w: 2.2 });
    const [kx, kz] = m.to(2.4, 4.9);
    ctx.anchor('specialtyCounter', kx, kz, rot);
    const [ix, iz] = m.to(2.4, 7.6);
    ctx.service('shop', ix, iz, 'Bramble’s Bakery', 'hearthwick_bakery', 2.8, 'specialty');
    const [bx, bz] = m.to(-5.5, 3.2);
    kit(ctx, 'town_sack', bx, bz, rot + 0.4); kit(ctx, 'town_sack', bx + 0.6, bz + 0.3, rot - 0.2); kit(ctx, 'town_barrel', bx - 0.2, bz - 0.9, rot);
  }
  // The Keeper (storage) — SE: a stone storehouse with a hoist and crates
  {
    const [x, z, rot] = at(40, 22.5);
    const m = house(ctx, x, z, rot, {
      w: 9.5, d: 7.5, floors: 2, gh: 3.4, fh: 2.6, ground: 'stone', upper: 'planks', gableFront: true,
      pal: pal(4, { wall: '#9a7a58', wall2: '#a8845c', roof: '#6a5a4a', door: '#4a3a2a', trim: '#5a4430', shutter: undefined }),
      rise: 3.4, door: { x: 0, double: true }, win: { shutters: false },
      sign: { text: 'The Keeper', sub: 'Team & storage', icon: '▣', bg: '#2e2418', accent: '#d9b25f' },
    });
    ctx.service('storage', m.door[0], m.door[1], 'The Keeper — Team & Storage', undefined, 3.2);
    ctx.anchor('storage', ...m.door, m.yaw);
    const [gx, gz] = m.to(-6.2, 2.4);
    goods(ctx, gx, gz, rot + 0.3, r, 5, ['town_crate', 'town_crate_b', 'town_crate_long', 'town_barrel']);
    const [cx, cz] = m.to(6.3, 1.5);
    kit(ctx, 'town_cart', cx, cz, rot + Math.PI / 2 + 0.3);
    ctx.collide(cx, cz, 1.0);
  }
  // quest board (faces arriving players on the main street) + market corner
  questBoard(ctx, 8.4, 17.2, ctx.face(8.4, 17.2, -1, 30));
  {
    const rot = ctx.face(8.4, 17.2, -1, 30);
    const [qx, qz] = toTown(8.4, 17.2, rot, 0, 1.4);
    ctx.service('quests', qx, qz, 'Quest Board', undefined, 3.0);
    ctx.anchor('questBoard', qx + 1.4, qz, rot);
  }
  stall(ctx, -8.4, 18.2, ctx.face(-8.4, 18.2, 2, 26), ['#6a9a4a', '#f4efe2'], 'fruit');
  ctx.anchor('market', -4.2, 12.6, ctx.face(-4.2, 12.6, 0, 26));
  ctx.anchor('plaza', 0, 6.2, Math.PI);

  // ── east street: hatchery + houses + gate ──────────────────────────────────────────────
  {
    const m = house(ctx, 32.5, -10.5, 0, {
      w: 10, d: 8, floors: 1, gh: 4.2, ground: 'planks', gableFront: true,
      pal: pal(3, { wall: '#e8c768', trim: '#fbf3dc', roof: '#8e4a36', door: '#a0522d', shutter: undefined, timber: '#fbf3dc' }),
      rise: 4.2, door: { x: 0, double: true, arch: true }, win: { shutters: false },
      sign: { text: 'Hatchery', sub: 'Eggs · breeding · warm straw', icon: '◉', bg: '#5a3a0e', accent: '#ffd76a' },
    });
    ctx.service('hatchery', m.door[0], m.door[1], 'Hatchery', undefined, 3.2);
    ctx.anchor('hatchery', ...m.door, 0);
    // nest yard beside the barn
    fence(ctx, [[39, -6], [45, -6], [45, -17], [39, -17]], 'rail');
    hay(ctx, 42, -9, 0.3); hay(ctx, 43.2, -13.5, 1.2);
    for (const [ex, ez] of [[41.2, -11.2], [43.5, -8.1], [40.8, -14.6]] as P2[]) {
      ctx.on(ex, ez, 0, () => {
        ctx.b.cyl('solid', 0, 0, 0, 0.45, 0.22, '#c8a45a', { sides: 10, top: 1.15 });
        for (let k = 0; k < 3; k++) ctx.b.sphere('solid', (k - 1) * 0.16, 0.3, (k % 2) * 0.1, 0.11, 0.15, 0.11, ['#fff4dc', '#f4e0c0', '#e8f0ff'][k], { w: 8, h: 6 });
      });
    }
  }
  cottage(ctx, 32, 10.5, Math.PI, 5);
  cottage(ctx, 44, 11, Math.PI, 6, { w: 7, floors: 1 });
  cottage(ctx, 45.5, -24, -Math.PI / 2 + 0.5, 7, { w: 7, d: 6 });

  // ── west street: dojo + training yard, shrine garden, house ────────────────────────────
  {
    const m = house(ctx, -32.5, -10.5, 0, {
      w: 9.5, d: 7, floors: 1, gh: 3.6, ground: 'timber', roof: 'hip',
      pal: pal(3, { wall: '#f1e6d2', roof: '#a8402e', door: '#6a2a1e', shutter: '#a8402e' }),
      rise: 2.8, door: { x: 0, double: true }, porch: { depth: 1.8 },
      sign: { text: 'Move Master', sub: 'Sharpen every skill', icon: '⚔', bg: '#4a1a12', accent: '#f0a080' },
    });
    ctx.service('tutor', m.door[0], m.door[1], 'Move Master', undefined, 3.2);
    ctx.anchor('tutor', ...m.door, 0);
    fence(ctx, [[-39, -5], [-48, -5], [-48, -17], [-39.5, -17]], 'rail');
    kit(ctx, 'town_target', -45, -13, 0.2); kit(ctx, 'town_target', -42.5, -14.5, -0.3);
    kit(ctx, 'town_weaponrack', -46.5, -8, Math.PI / 2);
    ctx.collide(-45, -13, 0.5); ctx.collide(-42.5, -14.5, 0.5); ctx.collide(-46.5, -8, 0.7);
  }
  rotunda(ctx, -32, 12, 0, { dome: '#6a4a9a', crystal: '#c68bff' });
  ctx.service('shrine', -32, 6.4, 'Elementum Shrine', undefined, 3.4);
  ctx.anchor('shrine', -32, 6.8, Math.PI);
  flowers(ctx, -26.5, 16, 1.4, ['#b58aff', '#ffffff', '#f08aa8'], 10);
  flowers(ctx, -37.5, 17, 1.4, ['#b58aff', '#ffd24a', '#ffffff'], 10);
  cottage(ctx, -44.5, 11, Math.PI, 8, { w: 7, floors: 2 });

  // ── north street: Elder Maple's study + observatory, houses ────────────────────────────
  {
    const m = house(ctx, -11.5, -38, Math.PI / 2, {
      w: 10.5, d: 8, floors: 2, gh: 3.2, fh: 2.9, ground: 'stone', upper: 'timber', jetty: 0.3,
      pal: pal(2, { roof: '#5f7650', wall2: '#efe9d8', door: '#3a5a3a', shutter: '#5f7650' }),
      rise: 4.0, chimney: -1, door: { x: 0, arch: true, canopy: '#5f7650' }, win: { flowers: true },
      sign: { text: 'Maple’s Study', sub: 'Mystic scholar', icon: '✎', bg: '#1e3222', accent: '#b8d8a0' },
    });
    ctx.anchor('elderDoor', ...m.door, Math.PI / 2);
    ctx.anchor('leader', m.door[0] + 0.6, m.door[1] + 1.2, Math.PI / 2);
    observatory(ctx, -14.5, -47.5, 0.4, pal(2));
    planter(ctx, -5.2, -31.5, Math.PI / 2, 2.2, 0.9, { colors: ['#b8d8a0', '#ffffff', '#ffd24a'], veg: true });
  }
  cottage(ctx, 10.5, -35, -Math.PI / 2, 9);
  cottage(ctx, 10.5, -45, -Math.PI / 2, 10, { floors: 1, w: 7 });

  // ── main street (arrival) ──────────────────────────────────────────────────────────────
  cottage(ctx, -10, 26.5, Math.PI / 2, 11, { w: 8 });
  cottage(ctx, -10, 36.5, Math.PI / 2, 12, { w: 7.5 });
  cottage(ctx, -10, 46, Math.PI / 2, 13, { w: 7, floors: 1 });
  cottage(ctx, 10, 26.5, -Math.PI / 2, 14, { w: 8 });
  cottage(ctx, 10, 36.5, -Math.PI / 2, 15, { w: 7.5 });
  cottage(ctx, 10, 46, -Math.PI / 2, 16, { w: 7, floors: 1 });
  for (const [lx, lz] of [[3.7, 22], [-3.7, 31], [3.7, 40], [-3.7, 49], [3.9, 57]] as P2[]) lamp(ctx, lx, lz, 'iron');

  // ── gardens, orchard, woodpiles in the back lots ───────────────────────────────────────
  for (let i = 0; i < 3; i++) planter(ctx, -29 - i * 3.2, 33, 0, 2.4, 1.1, { veg: true });
  for (let i = 0; i < 2; i++) planter(ctx, -30.5 - i * 3.2, 37.5, 0, 2.4, 1.1, { veg: true });
  woodpile(ctx, -22.5, 38, 0.2);
  kit(ctx, 'town_wheelbarrow', -26.5, 40, 0.8);
  for (const [tx, tz, st] of [[24, 24, 'round'], [30, 27, 'blossom'], [22, 34, 'blossom'], [35, 35, 'round'], [28, 40, 'round']] as [number, number, 'round' | 'blossom'][]) tree(ctx, tx, tz, st, 0.8 + r() * 0.25);
  bench(ctx, 26.5, 31.5, -0.6);
  ctx.anchor('bench5', 25.6, 30.4, -0.6 + Math.PI);
  tree(ctx, -24, -26, 'round', 1.05); tree(ctx, 24, -27, 'round', 1.0);
  tree(ctx, 38, -34, 'birch', 0.95); tree(ctx, -38, -33, 'birch', 1.0);
  flowers(ctx, 18, -30, 1.5, ['#ffd24a', '#ffffff'], 8);

  // ── town edge: fieldstone walls, hedges, four gates ────────────────────────────────────
  const ringPts: P2[] = [[0, -52], [26, -47], [44, -30], [52, 0], [46, 28], [30, 46], [11, 59], [0, 64], [-11, 59], [-30, 46], [-46, 28], [-52, 0], [-44, -30], [-26, -47], [0, -52]];
  const gates: P2[] = [[0, -52], [52, 0], [0, 64], [-52, 0]];
  edgeWalls(ctx, ringPts, gates, (i) => (i % 3 === 1 ? 'hedge' : 'stone'));
  gateArch(ctx, 0, 64, 0, 5.2, 'timber', { stone: '#a89e8e', wood: TIMBER, roof: '#8e4a36' }, { text: 'Hearthwick', sub: 'Welcome, Wayfarer', bg: '#3a2618', accent: '#d9b25f' });
  gateArch(ctx, 52, 0, Math.PI / 2, 5, 'timber', { stone: '#a89e8e', wood: TIMBER, roof: '#8e4a36' }, { text: 'East Road', sub: 'Saltwind Gate · Homestead' });
  gateArch(ctx, -52, 0, -Math.PI / 2, 5, 'timber', { stone: '#a89e8e', wood: TIMBER, roof: '#8e4a36' }, { text: 'West Road', sub: 'Willowmere · Miller’s Rise' });
  gateArch(ctx, 0, -52, Math.PI, 4.6, 'timber', { stone: '#a89e8e', wood: TIMBER, roof: '#8e4a36' }, { text: 'Crown Road', sub: 'Mount Aether' });
  ctx.anchor('gate', 0, 70.5, Math.PI);
  ctx.anchor('eastGate', 56, 0, -Math.PI / 2);
  ctx.anchor('westGate', -56, 0, Math.PI / 2);
  ctx.anchor('northGate', 0, -56, 0);

  // guard post just inside the South Gate (Warden Brisa)
  {
    const m = house(ctx, 7.6, 57.5, -Math.PI / 2, {
      w: 3.4, d: 3.2, floors: 1, gh: 2.8, ground: 'stone', roof: 'pyramid', rise: 1.6,
      pal: pal(0, { roof: '#8e4a36', door: '#4a3a2a' }), door: false, win: { shutters: false, w: 0.7, h: 0.7 }, sideWindows: true, far: false,
    });
    void m;
    banner(ctx, 4.4, 60.4, 0, '#3f7a4a', { h: 4.0, emblem: '#f4d24a' });
    ctx.anchor('guardPost', 3.4, 61.4, 0);
    kit(ctx, 'town_barrel', 9.8, 55.2, 0.4); kit(ctx, 'town_weaponrack', 9.9, 60.2, -Math.PI / 2);
  }
  banner(ctx, -4.4, 60.4, 0, '#3f7a4a', { h: 4.0, emblem: '#f4d24a' });
  signpost(ctx, -4.6, 72, Math.PI, 'Hearthwick', { sub: 'Market · Healer · Spire', icon: '⌂' });

  // ── benches & gathering spots (anchors for townsfolk) ──────────────────────────────────
  bench(ctx, -6.2, 27.2, Math.PI / 2 + Math.PI);
  bench(ctx, 6.2, 33.5, -Math.PI / 2 + Math.PI);
  ctx.anchor('bench1', 5.6, 8.6, ctx.face(5.6, 8.6, 0, 0));
  ctx.anchor('bench2', -8.6, 5.4, ctx.face(-8.6, 5.4, 0, 0));
  ctx.anchor('bench3', -5.4, 29.2, Math.PI / 2);
  ctx.anchor('bench4', 7.4, -7.8, ctx.face(7.4, -7.8, 0, 0));

  // arrival point for fast travel: inside the South Gate, looking up the main street
  ctx.anchor('spawn', 0, 44, Math.PI);
}

/** Walls along a closed ring, leaving a gap at each gate. */
export function edgeWalls(ctx: TownCtx, ring: P2[], gates: P2[], style: (i: number) => 'stone' | 'hedge' | 'picket' | 'rail' | 'palisade' | 'adobe' | 'basalt' | 'rampart', gap = 3.4, extra: { color?: string; h?: number } = {}) {
  for (let i = 0; i < ring.length - 1; i++) {
    let a = ring[i], b = ring[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    if (gates.some((g) => Math.hypot(g[0] - a[0], g[1] - a[1]) < 0.5)) a = [a[0] + dir[0] * gap, a[1] + dir[1] * gap];
    if (gates.some((g) => Math.hypot(g[0] - b[0], g[1] - b[1]) < 0.5)) b = [b[0] - dir[0] * gap, b[1] - dir[1] * gap];
    fence(ctx, [a, b], style(i), extra);
  }
}
