import { validateRects } from './validate.js';
import { removeCollinear, ensureClockwise, polygonArea } from './geometry.js';

/**
 * Computes the 2D boolean union of an array of axis-aligned rectangles.
 * Returns an array of closed polygon contours (one per connected component).
 *
 * @param {Array<import('./types.js').Rect>} rects
 * @returns {Array<Array<import('./types.js').Point>>}
 */
export function unionRects(rects) {
  validateRects(rects);

  // Quantize coordinates to merge subpixel differences (< 0.001px)
  const quantize = (v) => Math.round(v * 1000) / 1000;
  const processedRects = rects.map(r => ({
    x: quantize(r.x),
    y: quantize(r.y),
    w: quantize(r.w),
    h: quantize(r.h),
  }));

  // 1. Collect and sort unique coordinates, merging coordinates within 0.001px
  const xVals = [];
  const yVals = [];

  for (const r of processedRects) {
    xVals.push(r.x, quantize(r.x + r.w));
    yVals.push(r.y, quantize(r.y + r.h));
  }

  function clusterCoordinates(vals, eps = 1e-3) {
    const sorted = Array.from(vals).sort((a, b) => a - b);
    const result = [];
    for (const v of sorted) {
      if (result.length === 0) {
        result.push(v);
      } else {
        const prev = result[result.length - 1];
        if (Math.abs(v - prev) < eps) {
          continue;
        }
        result.push(v);
      }
    }
    return result;
  }

  const xs = clusterCoordinates(xVals, 1e-3);
  const ys = clusterCoordinates(yVals, 1e-3);

  const nx = xs.length - 1;
  const ny = ys.length - 1;

  if (nx <= 0 || ny <= 0) return [];

  // 2. Build 2D grid of filled cells
  /** @type {boolean[][]} */
  const grid = Array.from({ length: ny }, () => new Array(nx).fill(false));

  for (const r of processedRects) {
    const rx2 = quantize(r.x + r.w);
    const ry2 = quantize(r.y + r.h);

    // Find index ranges with 1e-4 tolerance for clustered grid
    let iStart = 0;
    while (iStart < nx && xs[iStart + 1] <= r.x + 1e-4) iStart++;
    let iEnd = iStart;
    while (iEnd < nx && xs[iEnd] < rx2 - 1e-4) iEnd++;

    let jStart = 0;
    while (jStart < ny && ys[jStart + 1] <= r.y + 1e-4) jStart++;
    let jEnd = jStart;
    while (jEnd < ny && ys[jEnd] < ry2 - 1e-4) jEnd++;

    for (let j = jStart; j < jEnd; j++) {
      for (let i = iStart; i < iEnd; i++) {
        grid[j][i] = true;
      }
    }
  }

  // 3. Extract directed boundary edges (interior on the right in screen coordinates)
  /** @type {Array<{
   *   x1: number, y1: number,
   *   x2: number, y2: number,
   *   dx: number, dy: number,
   *   used: boolean
   * }>} */
  const edges = [];

  // Horizontal edges: along y = ys[j]
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const above = j > 0 ? grid[j - 1][i] : false;
      const below = j < ny ? grid[j][i] : false;

      if (below && !above) {
        // Interior below: vector (+1, 0)
        edges.push({
          x1: xs[i], y1: ys[j],
          x2: xs[i + 1], y2: ys[j],
          dx: 1, dy: 0,
          used: false,
        });
      } else if (above && !below) {
        // Interior above: vector (-1, 0)
        edges.push({
          x1: xs[i + 1], y1: ys[j],
          x2: xs[i], y2: ys[j],
          dx: -1, dy: 0,
          used: false,
        });
      }
    }
  }

  // Vertical edges: along x = xs[i]
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) {
      const left = i > 0 ? grid[j][i - 1] : false;
      const right = i < nx ? grid[j][i] : false;

      if (left && !right) {
        // Interior left: vector (0, 1) in screen coordinates
        edges.push({
          x1: xs[i], y1: ys[j],
          x2: xs[i], y2: ys[j + 1],
          dx: 0, dy: 1,
          used: false,
        });
      } else if (right && !left) {
        // Interior right: vector (0, -1)
        edges.push({
          x1: xs[i], y1: ys[j + 1],
          x2: xs[i], y2: ys[j],
          dx: 0, dy: -1,
          used: false,
        });
      }
    }
  }

  if (edges.length === 0) return [];

  // 4. Map edges by starting point
  /** @type {Map<string, Array<typeof edges[0]>>} */
  const startMap = new Map();
  const pointKey = (x, y) => `${x},${y}`;

  for (const e of edges) {
    const k = pointKey(e.x1, e.y1);
    let list = startMap.get(k);
    if (!list) {
      list = [];
      startMap.set(k, list);
    }
    list.push(e);
  }

  // 5. Chain edges into closed contours
  const contours = [];

  for (const edge of edges) {
    if (edge.used) continue;

    const contour = [];
    let currentEdge = edge;

    while (currentEdge && !currentEdge.used) {
      currentEdge.used = true;
      contour.push({ x: currentEdge.x1, y: currentEdge.y1 });

      const nextStartKey = pointKey(currentEdge.x2, currentEdge.y2);
      const candidates = (startMap.get(nextStartKey) || []).filter(e => !e.used);

      if (candidates.length === 0) {
        break;
      } else if (candidates.length === 1) {
        currentEdge = candidates[0];
      } else {
        // Multiple outgoing edges (saddle / diagonal point)
        // Pair by boundary continuity: choose the edge that maintains polygon interior on the right
        let chosen = null;
        if (currentEdge.dx === 0 && currentEdge.dy === 1) {
          // Incoming Down (0, 1) -> choose Left (-1, 0)
          chosen = candidates.find(c => c.dx === -1 && c.dy === 0);
        } else if (currentEdge.dx === 0 && currentEdge.dy === -1) {
          // Incoming Up (0, -1) -> choose Right (1, 0)
          chosen = candidates.find(c => c.dx === 1 && c.dy === 0);
        } else if (currentEdge.dx === 1 && currentEdge.dy === 0) {
          // Incoming Right (1, 0) -> choose Down (0, 1)
          chosen = candidates.find(c => c.dx === 0 && c.dy === 1);
        } else if (currentEdge.dx === -1 && currentEdge.dy === 0) {
          // Incoming Left (-1, 0) -> choose Up (0, -1)
          chosen = candidates.find(c => c.dx === 0 && c.dy === -1);
        }
        currentEdge = chosen || candidates[0];
      }
    }

    if (contour.length >= 4) {
      const cleanContour = removeCollinear(ensureClockwise(contour));
      if (cleanContour.length >= 4 && polygonArea(cleanContour) > 0) {
        contours.push(cleanContour);
      }
    }
  }

  // 6. Contact continuity: map contact limits between touching/overlapping rects
  if (rects.length > 1) {
    const contactMap = new Map();
    const addLimit = (x, y, limit) => {
      const k = `${Math.round(x * 1e4) / 1e4},${Math.round(y * 1e4) / 1e4}`;
      const prev = contactMap.get(k);
      if (prev === undefined || limit < prev) {
        contactMap.set(k, limit);
      }
    };

    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const ra = rects[a];
        const rb = rects[b];

        const xMin = Math.max(ra.x, rb.x);
        const xMax = Math.min(ra.x + ra.w, rb.x + rb.w);
        const yMin = Math.max(ra.y, rb.y);
        const yMax = Math.min(ra.y + ra.h, rb.y + rb.h);

        const xOverlap = xMax - xMin;
        const yOverlap = yMax - yMin;

        // Vertical edge touch (xOverlap === 0 and yOverlap > 0)
        if (Math.abs(xOverlap) < 1e-5 && yOverlap > 0) {
          addLimit(xMin, yMin, yOverlap);
          addLimit(xMin, yMax, yOverlap);
        }
        // Horizontal edge touch (yOverlap === 0 and xOverlap > 0)
        else if (Math.abs(yOverlap) < 1e-5 && xOverlap > 0) {
          addLimit(xMin, yMin, xOverlap);
          addLimit(xMax, yMin, xOverlap);
        }
        // Overlap
        else if (xOverlap > 0 && yOverlap > 0) {
          const limit = Math.min(xOverlap, yOverlap);
          addLimit(xMin, yMin, limit);
          addLimit(xMin, yMax, limit);
          addLimit(xMax, yMin, limit);
          addLimit(xMax, yMax, limit);
        }
      }
    }

    for (const c of contours) {
      for (const p of c) {
        const k = `${Math.round(p.x * 1e4) / 1e4},${Math.round(p.y * 1e4) / 1e4}`;
        const limit = contactMap.get(k);
        if (limit !== undefined) {
          p.contactLimit = limit;
        }
      }
    }
  }

  // Sort contours deterministically by bounding box top-left
  contours.sort((a, b) => {
    const minAy = Math.min(...a.map(p => p.y));
    const minBy = Math.min(...b.map(p => p.y));
    if (Math.abs(minAy - minBy) > 1e-4) return minAy - minBy;
    const minAx = Math.min(...a.map(p => p.x));
    const minBx = Math.min(...b.map(p => p.x));
    return minAx - minBx;
  });

  return contours;
}
