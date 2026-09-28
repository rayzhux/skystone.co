// Builds the particle target shapes off the main thread.
import { buildShapes } from './shapes.js';

self.onmessage = (e) => {
  const { side, mask } = e.data;
  const out = buildShapes(side, mask);
  self.postMessage(out, [out.pos.buffer, out.attr.buffer]);
};
