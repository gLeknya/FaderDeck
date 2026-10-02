# fillet.js
```
import { getCornerInfo, getFilletCenter } from './geometry.js';

/**
 * Calculates fillet corners for a polygon, applying proportional auto-limiting
 * to ensure fillets on adjacent corners never overlap.
 *
 * @param {Array<import('./types.js').Point>} vertices - CW oriented vertices
 * @param {import('./types.js').BuildPathOptions} [opts]
 * @returns {Array<{
 *   vertex: import('./types.js').Point,
 *   isConcave: boolean,
 *   r: number,
 *   t: number,
 *   pStart: {x: number, y: number},
 *   pEnd: {x: number, y: number},
 *   center: {x: number, y: number},
 *   sweep: number
 * }>}
 */
export function calculateFillets(vertices, opts = {}) {
  const n = vertices.length;
  if (n < 3) return [];

  const defaultRadius = opts.radius ?? 0;
  const defaultConcaveRadius = opts.concaveRadius ?? defaultRadius;

  // 1. Gather corner info and target radii
  const corners = [];
  const targetRadii = [];
  const targetTangents = [];

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const info = getCornerInfo(prev, curr, next);
    corners.push(info);

    // Vertex-specific radius overrides general options
    let r = curr.r !== undefined
      ? curr.r
      : info.isConcave
        ? defaultConcaveRadius
        : defaultRadius;

    // Contact continuity: limit concave corner radius by the contact length
    if (info.isConcave && curr.contactLimit !== undefined) {
      r = Math.min(r, curr.contactLimit);
    }

    if (r < 0 || Number.isNaN(r)) r = 0;
    targetRadii.push(r);

    // Tangent distance: t = r / tan(theta / 2)
    let t = (r > 0 && info.tanHalfTheta > 1e-7 && Number.isFinite(info.tanHalfTheta))
      ? r / info.tanHalfTheta
      : 0;

    if (info.isConcave && curr.contactLimit !== undefined) {
      t = Math.min(t, curr.contactLimit);
    }

    targetTangents.push(t);
  }

  // 2. Auto-limit radii: adjacent fillets share edge length
  // Edge i goes from vertex i to vertex (i + 1)
  const edgeScales = [];
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const edgeLen = corners[i].lenOut;
    const requiredLen = targetTangents[i] + targetTangents[nextIdx];

    if (requiredLen > 0 && edgeLen < requiredLen) {
      edgeScales.push(Math.max(0, edgeLen / requiredLen));
    } else {
      edgeScales.push(1);
    }
  }

  // Scale each vertex by the minimum scale factor of its two adjacent edges
  const vertexScales = [];
  for (let i = 0; i < n; i++) {
    const prevEdgeIdx = (i - 1 + n) % n;
    const currEdgeIdx = i;
    const scale = Math.min(1, edgeScales[prevEdgeIdx], edgeScales[currEdgeIdx]);
    vertexScales.push(scale);
  }

  // 3. Compute final fillet endpoints and center
  const result = [];
  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const info = corners[i];
    const scale = vertexScales[i];

    const rEff = targetRadii[i] * scale;
    const tEff = targetTangents[i] * scale;

    const pStart = {
      x: curr.x + tEff * info.u1.x,
      y: curr.y + tEff * info.u1.y,
    };
    const pEnd = {
      x: curr.x + tEff * info.u2.x,
      y: curr.y + tEff * info.u2.y,
    };

    // Center of circular arc
    const center = getFilletCenter(pStart, info.inDir, rEff, info.isConcave);

    // Convex: sweep = 1, Concave: sweep = 0 (in screen coords, CW winding)
    const sweep = info.isConcave ? 0 : 1;

    result.push({
      vertex: curr,
      isConcave: info.isConcave,
      r: rEff,
      t: tEff,
      pStart,
      pEnd,
      center,
      sweep,
    });
  }

  return result;
}

/**
 * Builds an SVG path `d` string with a fixed command structure:
 * M pEnd_{n-1} [L pStart_i A r_i r_i 0 0 sweep_i pEnd_i] * n Z
 *
 * @param {Array<{
 *   r: number,
 *   sweep: number,
 *   pStart: {x: number, y: number},
 *   pEnd: {x: number, y: number}
 * }>} fillets
 * @param {number} [precision=3]
 * @returns {string}
 */
export function filletsToPathString(fillets, precision = 3) {
  const n = fillets.length;
  if (n === 0) return '';

  const fmt = (val) => {
    const fixed = val.toFixed(precision);
    // Remove unnecessary trailing zeroes after decimal point
    return Number(fixed).toString();
  };

  const lastFillet = fillets[n - 1];
  const parts = [`M ${fmt(lastFillet.pEnd.x)} ${fmt(lastFillet.pEnd.y)}`];

  for (let i = 0; i < n; i++) {
    const f = fillets[i];
    parts.push(
      `L ${fmt(f.pStart.x)} ${fmt(f.pStart.y)}`,
      `A ${fmt(f.r)} ${fmt(f.r)} 0 0 ${f.sweep} ${fmt(f.pEnd.x)} ${fmt(f.pEnd.y)}`
    );
  }

  parts.push('Z');
  return parts.join(' ');
}

```

# Union.js

```
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

  // 1. Collect and sort unique coordinates
  const xSet = new Set();
  const ySet = new Set();

  for (const r of rects) {
    xSet.add(r.x);
    xSet.add(r.x + r.w);
    ySet.add(r.y);
    ySet.add(r.y + r.h);
  }

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);

  const nx = xs.length - 1;
  const ny = ys.length - 1;

  if (nx <= 0 || ny <= 0) return [];

  // 2. Build 2D grid of filled cells
  /** @type {boolean[][]} */
  const grid = Array.from({ length: ny }, () => new Array(nx).fill(false));

  for (const r of rects) {
    const rx2 = r.x + r.w;
    const ry2 = r.y + r.h;

    // Find index ranges
    let iStart = 0;
    while (iStart < nx && xs[iStart + 1] <= r.x) iStart++;
    let iEnd = iStart;
    while (iEnd < nx && xs[iEnd] < rx2) iEnd++;

    let jStart = 0;
    while (jStart < ny && ys[jStart + 1] <= r.y) jStart++;
    let jEnd = jStart;
    while (jEnd < ny && ys[jEnd] < ry2) jEnd++;

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

```

# joinShapes.js

```
import { findPositionedAncestor } from './ancestor.js';
import { measureRelativeRects } from './measure.js';
import { roundedUnion } from '../core/path.js';
import { createSvgLayer, setPathD } from '../render/svg.js';
import { buildPatchesPath, resolvePatchColor } from './patches.js';

/**
 * Joins multiple DOM elements into a single continuous shape with concave corner fillets.
 *
 * @param {Array<HTMLElement | SVGElement>} elements - Array of DOM elements to join
 * @param {Object} [options]
 * @param {number} [options.radius=0]
 * @param {number} [options.concaveRadius]
 * @param {'svg' | 'clip' | 'patches'} [options.mode='svg']
 * @param {string} [options.patchColor] - Color for patches mode
 * @param {boolean | 'always'} [options.follow=false]
 * @param {boolean} [options.snap=true]
 * @param {number} [options.bleed=0]
 * @param {number} [options.precision=3]
 * @param {number} [options.smoothing=0]
 * @returns {{
 *   update: () => void,
 *   setRadius: (r: number, concaveR?: number) => void,
 *   getPath: () => string,
 *   destroy: () => void,
 *   container: HTMLElement | null,
 *   svgElement?: SVGSVGElement,
 *   pathElement?: SVGPathElement
 * }}
 */
export function joinShapes(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new TypeError('joinShapes requires a non-empty array of DOM elements');
  }

  const container = findPositionedAncestor(elements);
  if (!container) {
    throw new Error('Could not find a common ancestor for the provided elements');
  }

  let isDestroyed = false;
  let currentOptions = { ...options };
  const mode = currentOptions.mode || 'svg';
  const follow = currentOptions.follow || false;

  let svgObj = null;
  let currentPathString = '';
  let rafId = null;
  let activeAnimationCount = 0;

  // Create SVG layer if mode is 'svg' or 'patches'
  if (mode === 'svg' || mode === 'patches') {
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    svgObj = createSvgLayer(doc);

    if (mode === 'patches') {
      const color = resolvePatchColor(elements, currentOptions.patchColor);
      svgObj.path.style.fill = color;
      // In patches mode, overlay sits on top of elements
      svgObj.svg.style.zIndex = '10';
      container.appendChild(svgObj.svg);
    } else {
      if (container.firstChild) {
        container.insertBefore(svgObj.svg, container.firstChild);
      } else {
        container.appendChild(svgObj.svg);
      }
    }
  }

  // Update routine: batch measures and re-renders
  const update = () => {
    if (isDestroyed) return;
    const rects = measureRelativeRects(elements, container);
    if (rects.length === 0) return;

    if (mode === 'patches') {
      currentPathString = buildPatchesPath(rects, currentOptions, currentOptions.precision || 3);
      if (svgObj && svgObj.path) {
        setPathD(svgObj.path, currentPathString);
      }
    } else if (mode === 'clip') {
      currentPathString = roundedUnion(rects, currentOptions);
      container.style.clipPath = currentPathString ? `path('${currentPathString}')` : '';
    } else {
      currentPathString = roundedUnion(rects, currentOptions);
      if (svgObj && svgObj.path) {
        setPathD(svgObj.path, currentPathString);
      }
    }
  };

  // Follow loop for continuous tracking
  const startFollowLoop = () => {
    if (rafId !== null || isDestroyed) return;
    const tick = () => {
      if (isDestroyed) return;
      update();

      if (follow === 'always' || activeAnimationCount > 0) {
        rafId = (typeof requestAnimationFrame === 'function')
          ? requestAnimationFrame(tick)
          : null;
      } else {
        rafId = null;
      }
    };
    rafId = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(tick)
      : null;
  };

  const stopFollowLoop = () => {
    if (rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
    }
  };

  // Setup ResizeObserver
  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      update();
    });
    for (const el of elements) {
      resizeObserver.observe(el);
    }
    resizeObserver.observe(container);
  }

  // Setup window resize listener
  const onWindowResize = () => update();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', onWindowResize, { passive: true });
  }

  // Setup follow listeners
  const onAnimStart = () => {
    activeAnimationCount++;
    startFollowLoop();
  };

  const onAnimEnd = () => {
    activeAnimationCount = Math.max(0, activeAnimationCount - 1);
    // Check WAAPI getAnimations
    const hasRunning = elements.some(el => {
      if (typeof el.getAnimations === 'function') {
        return el.getAnimations().some(a => a.playState === 'running');
      }
      return false;
    });

    if (!hasRunning && activeAnimationCount === 0 && follow !== 'always') {
      stopFollowLoop();
      // Final update after animation settles
      update();
    }
  };

  if (follow === 'always') {
    startFollowLoop();
  } else if (follow === true) {
    for (const el of elements) {
      el.addEventListener('transitionrun', onAnimStart);
      el.addEventListener('transitionstart', onAnimStart);
      el.addEventListener('animationstart', onAnimStart);

      el.addEventListener('transitionend', onAnimEnd);
      el.addEventListener('transitioncancel', onAnimEnd);
      el.addEventListener('animationend', onAnimEnd);
      el.addEventListener('animationcancel', onAnimEnd);
    }
  }

  // Initial render
  update();

  return {
    update,

    setRadius(r, concaveR) {
      if (isDestroyed) return;
      currentOptions.radius = r;
      if (concaveR !== undefined) {
        currentOptions.concaveRadius = concaveR;
      }
      update();
    },

    getPath() {
      return currentPathString;
    },

    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;

      stopFollowLoop();

      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }

      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onWindowResize);
      }

      if (follow === true) {
        for (const el of elements) {
          el.removeEventListener('transitionrun', onAnimStart);
          el.removeEventListener('transitionstart', onAnimStart);
          el.removeEventListener('animationstart', onAnimStart);

          el.removeEventListener('transitionend', onAnimEnd);
          el.removeEventListener('transitioncancel', onAnimEnd);
          el.removeEventListener('animationend', onAnimEnd);
          el.removeEventListener('animationcancel', onAnimEnd);
        }
      }

      if (mode === 'clip') {
        container.style.clipPath = '';
      } else if (svgObj && svgObj.svg) {
        if (svgObj.svg.parentNode) {
          svgObj.svg.parentNode.removeChild(svgObj.svg);
        }
      }
      svgObj = null;
    },

    container,

    get svgElement() {
      return svgObj?.svg;
    },

    get pathElement() {
      return svgObj?.path;
    }
  };
}

```