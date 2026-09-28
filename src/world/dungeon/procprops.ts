import * as THREE from 'three';
import { mulberry32 } from '../../core/noise';
import type { ThemeStyle } from '../../data/dungeons';

// Procedural dungeon props (v3:dungeons) for things no kit covers: glowing crystals, mushrooms,
// roots, braziers, anvils, sand drifts, ice spikes, meteor rocks. Geometries are cached; each
// prop is a list of (geometry, material) parts so the Batch can instance it like a kit piece.

export interface ProcPart { geometry: THREE.BufferGeometry; material: THREE.Material }

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();
const g = (k: string, make: () => THREE.BufferGeometry) => { let v = geoCache.get(k); if (!v) { v = make(); geoCache.set(k, v); } return v; };
const m = (k: string, make: () => THREE.Material) => { let v = matCache.get(k); if (!v) { v = make(); matCache.set(k, v); } return v; };

function merge(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let off = 0;
  for (const p0 of parts) {
    const p = p0.index ? p0 : p0;
    const pa = p.getAttribute('position'), na = p.getAttribute('normal'), ca = p.getAttribute('color');
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nor.push(na.getX(i), na.getY(i), na.getZ(i));
      if (ca) col.push(ca.getX(i), ca.getY(i), ca.getZ(i)); else col.push(1, 1, 1);
    }
    const ia = p.getIndex();
    if (ia) for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + off);
    else for (let i = 0; i < pa.count; i++) idx.push(i + off);
    off += pa.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function lumpy(radius: number, detail: number, amp: number, seed: number) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const rnd = mulberry32(seed);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 1 + (rnd() - 0.5) * amp * 2; seen.set(key, k); }
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

const std = (color: THREE.ColorRepresentation, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...o });

export type ProcKind = 'crystals' | 'crystal_big' | 'mushrooms' | 'root_arch' | 'root_hang' | 'brazier' | 'anvil' | 'sand' | 'ice_spike' | 'meteor' | 'stalagmite' | 'basin' | 'stele' | 'bones_pile' | 'gold_pile' | 'dais';

/** Parts for a procedural prop in the given theme. */
export function procProp(kind: ProcKind, theme: ThemeStyle, themeKey: string): ProcPart[] {
  const stone = new THREE.Color().setHSL(theme.stone.h, theme.stone.s * 0.8, 0.26 * theme.stone.l);
  const glow = new THREE.Color(theme.glow);
  switch (kind) {
    case 'crystals':
    case 'crystal_big': {
      const big = kind === 'crystal_big';
      const geo = g(kind, () => {
        const rnd = mulberry32(big ? 77 : 41);
        const parts: THREE.BufferGeometry[] = [];
        const n = big ? 9 : 6;
        for (let i = 0; i < n; i++) {
          const h = (big ? 2.2 : 0.9) * (0.5 + rnd());
          const r = (big ? 0.45 : 0.2) * (0.6 + rnd() * 0.6);
          const c = new THREE.OctahedronGeometry(1, 0).scale(r, h, r);
          const a = (i / n) * Math.PI * 2 + rnd();
          const lean = 0.15 + rnd() * 0.45;
          c.rotateZ(Math.cos(a) * lean).rotateX(Math.sin(a) * lean);
          c.translate(Math.cos(a) * r * (i ? 1.6 : 0), h * 0.45, Math.sin(a) * r * (i ? 1.6 : 0));
          parts.push(c.toNonIndexed());
        }
        return merge(parts);
      });
      const mat = m(`cry:${themeKey}`, () => new THREE.MeshStandardMaterial({ color: glow.clone().multiplyScalar(0.6), emissive: glow, emissiveIntensity: 1.35, roughness: 0.2, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 }));
      const base = g(`${kind}-base`, () => lumpy(big ? 1.1 : 0.5, 0, 0.25, 9).scale(1, 0.4, 1));
      return [{ geometry: geo, material: mat }, { geometry: base, material: m(`rock:${themeKey}`, () => std(stone)) }];
    }
    case 'mushrooms': {
      const stems = g('mush-stems', () => {
        const rnd = mulberry32(5);
        const ps: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) {
          const h = 0.35 + rnd() * 0.7, a = i * 2.3, r = i ? 0.35 + rnd() * 0.3 : 0;
          ps.push(new THREE.CylinderGeometry(0.05, 0.08, h, 6).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r).toNonIndexed());
        }
        return merge(ps);
      });
      const caps = g('mush-caps', () => {
        const rnd = mulberry32(5);
        const ps: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) {
          const h = 0.35 + rnd() * 0.7, a = i * 2.3, r = i ? 0.35 + rnd() * 0.3 : 0;
          const s = 0.18 + (h - 0.35) * 0.35;
          ps.push(new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(Math.cos(a) * r, h, Math.sin(a) * r).toNonIndexed());
        }
        return merge(ps);
      });
      return [
        { geometry: stems, material: m('mush-stem', () => std('#e8dcc0', { flatShading: false })) },
        { geometry: caps, material: m(`mush-cap:${themeKey}`, () => new THREE.MeshStandardMaterial({ color: glow.clone().multiplyScalar(0.5), emissive: glow, emissiveIntensity: 1.1, roughness: 0.5 })) },
      ];
    }
    case 'root_arch':
    case 'root_hang': {
      const geo = g(kind, () => {
        const rnd = mulberry32(kind === 'root_arch' ? 13 : 17);
        const ps: THREE.BufferGeometry[] = [];
        const n = kind === 'root_arch' ? 3 : 4;
        for (let i = 0; i < n; i++) {
          const pts: THREE.Vector3[] = [];
          const off = (i - (n - 1) / 2) * 0.7;
          for (let t = 0; t <= 8; t++) {
            const u = t / 8;
            if (kind === 'root_arch') pts.push(new THREE.Vector3(off + Math.sin(u * 3 + i) * 0.2, 4.2 - u * 4.3 + Math.sin(u * Math.PI) * 0.4, 0.15 + Math.sin(u * Math.PI) * (1.2 + rnd() * 0.8)));
            else pts.push(new THREE.Vector3(off + Math.sin(u * 4 + i * 2) * 0.25, 4.3 - u * (1.4 + rnd() * 1.6), 0.25 + u * 0.4));
          }
          const curve = new THREE.CatmullRomCurve3(pts);
          const tube = new THREE.TubeGeometry(curve, 16, kind === 'root_arch' ? 0.16 + rnd() * 0.08 : 0.08, 6, false);
          // taper toward the tip
          const p = tube.attributes.position as THREE.BufferAttribute;
          const v = new THREE.Vector3();
          for (let k = 0; k < p.count; k++) {
            const seg = Math.floor(k / 7) / 16;
            const c = curve.getPoint(Math.min(1, seg));
            v.fromBufferAttribute(p, k).sub(c).multiplyScalar(1 - seg * 0.7).add(c);
            p.setXYZ(k, v.x, v.y, v.z);
          }
          tube.computeVertexNormals();
          ps.push(tube.toNonIndexed());
        }
        return merge(ps);
      });
      const bark = new THREE.Color().setHSL(theme.wood.h, theme.wood.s * 0.7, 0.16 * theme.wood.l + 0.04);
      return [{ geometry: geo, material: m(`bark:${themeKey}`, () => std(bark, { flatShading: false, roughness: 0.95 })) }];
    }
    case 'brazier': {
      const bowl = g('brazier-bowl', () => {
        const pts = [new THREE.Vector2(0.0, 0.9), new THREE.Vector2(0.35, 0.9), new THREE.Vector2(0.45, 1.0), new THREE.Vector2(0.7, 1.25), new THREE.Vector2(0.62, 1.3), new THREE.Vector2(0.4, 1.1)];
        const lathe = new THREE.LatheGeometry(pts, 12);
        const post = new THREE.CylinderGeometry(0.16, 0.22, 0.9, 8).translate(0, 0.45, 0);
        const foot = new THREE.CylinderGeometry(0.45, 0.5, 0.18, 8).translate(0, 0.09, 0);
        return merge([lathe.toNonIndexed(), post.toNonIndexed(), foot.toNonIndexed()]);
      });
      return [{ geometry: bowl, material: m(`iron:${themeKey}`, () => std(stone.clone().lerp(new THREE.Color('#3a3036'), 0.5), { metalness: 0.55, roughness: 0.5 })) }];
    }
    case 'anvil': {
      const geo = g('anvil', () => merge([
        new THREE.BoxGeometry(0.9, 0.5, 0.6).translate(0, 0.25, 0).toNonIndexed(),
        new THREE.BoxGeometry(0.4, 0.35, 0.35).translate(0, 0.66, 0).toNonIndexed(),
        new THREE.BoxGeometry(1.3, 0.28, 0.55).translate(0.1, 0.96, 0).toNonIndexed(),
        new THREE.ConeGeometry(0.2, 0.55, 6).rotateZ(-Math.PI / 2).translate(0.98, 0.96, 0).toNonIndexed(),
      ]));
      return [{ geometry: geo, material: m('anvil', () => std('#2a2a30', { metalness: 0.8, roughness: 0.35 })) }];
    }
    case 'sand': {
      const geo = g('sand', () => lumpy(1.6, 2, 0.12, 21).scale(1.2, 0.32, 1).translate(0, -0.1, 0));
      const c = new THREE.Color().setHSL(theme.stone.h, Math.min(0.5, theme.stone.s + 0.1), 0.52);
      return [{ geometry: geo, material: m(`sand:${themeKey}`, () => std(c, { flatShading: false, roughness: 1 })) }];
    }
    case 'ice_spike': {
      const geo = g('ice', () => {
        const rnd = mulberry32(31);
        const ps: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) {
          const h = 1 + rnd() * 2.2, a = i * 1.9, r = i ? 0.5 + rnd() * 0.4 : 0;
          ps.push(new THREE.ConeGeometry(0.25 + rnd() * 0.25, h, 5).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r).toNonIndexed());
        }
        return merge(ps);
      });
      return [{ geometry: geo, material: m('icemat', () => new THREE.MeshStandardMaterial({ color: '#bfe8ff', emissive: '#4ab8ff', emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.85 })) }];
    }
    case 'meteor': {
      const geo = g('meteor', () => {
        const rock = lumpy(1, 1, 0.3, 61);
        const cnt = rock.attributes.position.count;
        const col = new Float32Array(cnt * 3);
        const rnd = mulberry32(62);
        for (let i = 0; i < cnt; i++) { const hot = rnd() < 0.18 ? 1 : 0; col.set(hot ? [4, 1.4, 3.2] : [0.25, 0.22, 0.32], i * 3); }
        rock.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return rock.translate(0, 0.6, 0);
      });
      return [{ geometry: geo, material: m(`meteor:${themeKey}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', emissive: glow, emissiveIntensity: 0.25, roughness: 0.9, flatShading: true })) }];
    }
    case 'stalagmite': {
      const geo = g('stalag', () => merge([
        new THREE.ConeGeometry(0.5, 2.4, 6).translate(0, 1.2, 0).toNonIndexed(),
        new THREE.ConeGeometry(0.3, 1.4, 6).translate(0.6, 0.7, 0.2).toNonIndexed(),
        new THREE.ConeGeometry(0.25, 1.0, 6).translate(-0.4, 0.5, -0.4).toNonIndexed(),
      ]));
      return [{ geometry: geo, material: m(`rock:${themeKey}`, () => std(stone)) }];
    }
    case 'basin': {
      const rim = g('basin', () => merge([
        new THREE.CylinderGeometry(1.35, 1.5, 0.7, 14).translate(0, 0.35, 0).toNonIndexed(),
        new THREE.CylinderGeometry(0.35, 0.45, 1.6, 8).translate(0, 0.8, 0).toNonIndexed(),
        new THREE.CylinderGeometry(0.6, 0.35, 0.3, 10).translate(0, 1.7, 0).toNonIndexed(),
      ]));
      const water = g('basin-water', () => new THREE.CylinderGeometry(1.18, 1.18, 0.05, 20).translate(0, 0.66, 0));
      return [
        { geometry: rim, material: m(`stonebasin:${themeKey}`, () => std(stone.clone().multiplyScalar(1.6))) },
        { geometry: water, material: m('spring-water', () => new THREE.MeshStandardMaterial({ color: '#3ad8c8', emissive: '#4affe0', emissiveIntensity: 1.2, roughness: 0.1 })) },
      ];
    }
    case 'stele': {
      const geo = g('stele', () => merge([
        new THREE.BoxGeometry(1.4, 2.4, 0.35).translate(0, 1.2 + 0.2, 0).toNonIndexed(),
        new THREE.BoxGeometry(1.7, 0.3, 0.6).translate(0, 0.15, 0).toNonIndexed(),
      ]));
      return [{ geometry: geo, material: m(`stele:${themeKey}`, () => std(stone.clone().multiplyScalar(1.4))) }];
    }
    case 'bones_pile': {
      const geo = g('bones', () => {
        const rnd = mulberry32(71);
        const ps: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 9; i++) ps.push(new THREE.CapsuleGeometry(0.05, 0.5, 2, 5).rotateZ(Math.PI / 2).rotateY(rnd() * Math.PI).translate((rnd() - 0.5) * 1.1, 0.06 + rnd() * 0.1, (rnd() - 0.5) * 1.1).toNonIndexed());
        return merge(ps);
      });
      return [{ geometry: geo, material: m('bone', () => std('#e8e0c8', { flatShading: false })) }];
    }
    case 'gold_pile': {
      const geo = g('gold', () => lumpy(1, 2, 0.08, 91).scale(1.1, 0.35, 1));
      return [{ geometry: geo, material: m('goldmat', () => new THREE.MeshStandardMaterial({ color: '#ffcc4a', emissive: '#ff9a1a', emissiveIntensity: 0.25, metalness: 0.9, roughness: 0.3, flatShading: true })) }];
    }
    case 'dais': {
      const geo = g('dais', () => merge([
        new THREE.CylinderGeometry(4.2, 4.5, 0.35, 24).translate(0, 0.175, 0).toNonIndexed(),
        new THREE.CylinderGeometry(3.4, 3.6, 0.3, 24).translate(0, 0.5, 0).toNonIndexed(),
      ]));
      return [{ geometry: geo, material: m(`dais:${themeKey}`, () => std(stone.clone().multiplyScalar(1.7), { flatShading: false })) }];
    }
  }
}
