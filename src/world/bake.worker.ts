// Web Worker: bakes the world fields off the main thread and transfers the buffers back.
import { bakeFields } from './terrainBake';

self.onmessage = (e: MessageEvent<{ cmSize: number }>) => {
  const f = bakeFields(e.data.cmSize, (p) => (self as unknown as Worker).postMessage({ progress: p }));
  const buffers = [f.height, f.grass, f.tall, f.path, f.slope, f.plaza, f.zoneIdx, f.grassCol, f.tallCol, f.waterShallow, f.waterDeep, f.colorMap].map((a) => a.buffer);
  (self as unknown as Worker).postMessage({ fields: f }, buffers as Transferable[]);
};
