import { performance } from 'node:perf_hooks';
import { roundedUnion } from '../src/index.js';

// Generate 20 realistic rectangles arranged in an interconnected panel/UI hierarchy
const rects20 = [
  // Sidebar & header
  { x: 0, y: 0, w: 250, h: 600 },
  { x: 250, y: 0, w: 800, h: 70 },
  // Main content cards & sections
  { x: 250, y: 70, w: 300, h: 200 },
  { x: 550, y: 70, w: 500, h: 200 },
  { x: 250, y: 270, w: 450, h: 180 },
  { x: 700, y: 270, w: 350, h: 180 },
  { x: 250, y: 450, w: 800, h: 150 },
  // Floating docks, badges & tabs
  { x: 100, y: 550, w: 300, h: 80 },
  { x: 380, y: 580, w: 220, h: 60 },
  { x: 580, y: 570, w: 200, h: 70 },
  { x: 200, y: 40, w: 80, h: 50 },
  { x: 500, y: 50, w: 120, h: 40 },
  { x: 750, y: 50, w: 160, h: 45 },
  // Interlocking sub-panels
  { x: 270, y: 90, w: 120, h: 140 },
  { x: 380, y: 110, w: 150, h: 130 },
  { x: 570, y: 90, w: 200, h: 140 },
  { x: 760, y: 110, w: 260, h: 130 },
  { x: 280, y: 290, w: 200, h: 120 },
  { x: 470, y: 310, w: 200, h: 110 },
  { x: 720, y: 290, w: 290, h: 130 }
];

console.log(`Starting benchmark for roundedUnion on ${rects20.length} rectangles...`);

// Warmup
for (let i = 0; i < 50; i++) {
  roundedUnion(rects20, { radius: 16, concaveRadius: 16 });
}

// Timed runs
const ITERATIONS = 1000;
const t0 = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  roundedUnion(rects20, { radius: 16, concaveRadius: 16 });
}

const totalTimeMs = performance.now() - t0;
const avgTimeMs = totalTimeMs / ITERATIONS;
const opsPerSec = Math.round(1000 / avgTimeMs);

console.log(`-----------------------------------------------`);
console.log(`Total time for ${ITERATIONS} runs: ${totalTimeMs.toFixed(2)} ms`);
console.log(`Average time per call (20 rects): ${avgTimeMs.toFixed(3)} ms`);
console.log(`Throughput: ${opsPerSec.toLocaleString()} calls/sec`);
console.log(`-----------------------------------------------`);
