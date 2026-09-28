// NPC busts for dialog portraits: each NPC's own 3D model, rendered once (head and shoulders, 3/4 view,
// warm key + cool rim light) into a small transparent image and cached by NPC id. The dialog box asks
// for faces through ui/portraits resolvers; a bust that finishes while its dialog is open swaps in live.
import * as THREE from 'three';
import type { Rig } from '../assets/placeholders';
import { registerPortraitResolver } from '../ui/portraits';

const SIZE = 320;
const cache = new Map<string, string>();
const queue: { id: string; make: () => Rig | null }[] = [];
let renderer: THREE.WebGLRenderer | null = null;
let idleTimer = 0;
let pumping = false;

registerPortraitResolver((id) => cache.get(id));
export const bustReady = (id: string) => cache.has(id);

/** Ask for a bust of this NPC. `make` builds a fresh rig for it (null while its model loads). */
export function queueBust(id: string, make: () => Rig | null) {
  if (cache.has(id) || queue.some((q) => q.id === id)) return;
  queue.push({ id, make });
  if (!pumping) setTimeout(pump, 400);
}

function pump() {
  pumping = true;
  const job = queue[0];
  if (!job) { pumping = false; idleTimer = window.setTimeout(release, 8000); return; }
  clearTimeout(idleTimer);
  const rig = job.make();
  if (!rig) { queue.push(queue.shift()!); setTimeout(pump, 500); return; } // model still loading
  queue.shift();
  try {
    cache.set(job.id, render(rig));
    dispatchEvent(new CustomEvent('wm-bust', { detail: job.id }));
  } catch (err) { console.warn('[busts] render failed', err); }
  setTimeout(pump, 60);
}

function render(rig: Rig): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8efff, 0x4a3524, 1.5));
  const key = new THREE.DirectionalLight(0xffe0b0, 2.8);
  key.position.set(-2.2, 3, 3.2);
  const rim = new THREE.DirectionalLight(0xa9c8ff, 2.2);
  rim.position.set(2.6, 2.2, -2.4);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(2, 0.5, 3);
  scene.add(key, rim, fill);

  rig.update(0.0001, 0);
  const root = rig.root;
  root.position.set(0, 0, 0);
  root.rotation.y = 0.42;
  scene.add(root);
  root.updateMatrixWorld(true);
  // frame the head: chibi rigs carry most of their mass up top, so aim at the upper third
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(0.2, box.max.y - box.min.y);
  const aim = new THREE.Vector3(0, box.min.y + h * 0.76, 0);
  const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 100);
  const dist = h * 1.62;
  cam.position.set(Math.sin(0.12) * dist, aim.y + h * 0.05, Math.cos(0.12) * dist);
  cam.lookAt(aim);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(root);
  return url;
}

/** The bust renderer only lives while there is work; free its GL context afterwards. */
function release() {
  if (!renderer || queue.length) return;
  renderer.dispose();
  renderer.forceContextLoss();
  renderer = null;
}
