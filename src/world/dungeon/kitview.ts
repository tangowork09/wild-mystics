import * as THREE from 'three';
import { THEMES, type DungeonTheme } from '../../data/dungeons';
import { loadKit, piece, themedMaterial, type KitId } from './kit';

// Dev tool (v3:dungeons): `?view=dgkit&kit=kaykit&theme=forge` renders a labelled contact sheet of a
// kit's pieces with the theme recolour applied, on its own canvas over the game.

export async function kitView(kit: KitId, themeKey: DungeonTheme, filter?: string) {
  const root = await loadKit(kit);
  if (!root) return;
  const theme = THEMES[themeKey];
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.AgXToneMapping;
  r.domElement.style.cssText = 'position:fixed;inset:0;z-index:9999';
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1c1a22');
  scene.add(new THREE.HemisphereLight('#ffffff', '#40384a', 2.2));
  const d = new THREE.DirectionalLight('#fff4e0', 2.4); d.position.set(4, 8, 6); scene.add(d);
  const names = root.children.map((c) => c.name).filter((n) => !filter || n.includes(filter));
  const cols = Math.ceil(Math.sqrt(names.length * 1.6));
  const labels: { p: THREE.Vector3; t: string }[] = [];
  const cell = kit === 'kenney' ? 1.6 : kit === 'quaternius' ? 3 : 6;
  names.forEach((n, i) => {
    const pc = piece(kit, n);
    if (!pc) return;
    const g = new THREE.Group();
    for (const part of pc.parts) {
      const m = new THREE.Mesh(part.geometry, themedMaterial(kit, part.material, themeKey, theme));
      m.matrixAutoUpdate = false;
      m.matrix.copy(part.matrix);
      g.add(m);
    }
    const x = (i % cols) * cell, z = Math.floor(i / cols) * cell;
    g.position.set(x, 0, z);
    scene.add(g);
    labels.push({ p: new THREE.Vector3(x, -0.3, z + cell * 0.35), t: `${n} ${pc.box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(1)).join('×')}` });
  });
  const rows = Math.ceil(names.length / cols);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 500);
  const cx = ((cols - 1) * cell) / 2, cz = ((rows - 1) * cell) / 2;
  cam.position.set(cx, Math.max(cols, rows) * cell * 0.95, cz + Math.max(cols, rows) * cell * 0.75);
  cam.lookAt(cx, 0, cz);
  r.render(scene, cam);
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;font:10px/1.1 Inter,sans-serif;color:#fff';
  for (const l of labels) {
    const v = l.p.clone().project(cam);
    const s = document.createElement('div');
    s.textContent = l.t;
    s.style.cssText = `position:absolute;left:${(v.x * 0.5 + 0.5) * innerWidth}px;top:${(-v.y * 0.5 + 0.5) * innerHeight}px;transform:translate(-50%,0);text-shadow:0 1px 2px #000;white-space:nowrap`;
    ov.appendChild(s);
  }
  document.body.appendChild(ov);
  (window as unknown as { __ready?: boolean }).__ready = true;
}
