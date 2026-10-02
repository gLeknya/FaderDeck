import { validateOptions, validatePolygon, validateRects } from './validate.js';
import { removeCollinear, ensureClockwise } from './geometry.js';
import { calculateFillets, filletsToPathString } from './fillet.js';
import { unionRects } from './union.js';

let lastValidPath = '';

/**
 * Returns the last valid path string generated.
 * @returns {string}
 */
export function getLastValidPath() {
  return lastValidPath;
}

/**
 * Resets the cached last valid path string.
 */
export function resetLastValidPath() {
  lastValidPath = '';
}

/**
 * Validates that all numbers in the generated SVG path string are finite.
 * If not, logs a detailed console.warn and returns the last valid path.
 *
 * @param {string} d
 * @param {any} input
 * @param {any} opts
 * @param {any[]} [fillets]
 * @returns {string}
 */
function checkFiniteAndFallback(d, input, opts, fillets = []) {
  if (typeof d !== 'string') {
    d = '';
  }

  let isInvalid = false;
  if (d.includes('NaN') || d.includes('Infinity')) {
    isInvalid = true;
  } else {
    const numbers = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
    if (numbers) {
      for (let i = 0; i < numbers.length; i++) {
        if (!Number.isFinite(Number(numbers[i]))) {
          isInvalid = true;
          break;
        }
      }
    }
  }

  if (isInvalid) {
    let brokenCorner = null;
    if (Array.isArray(fillets)) {
      for (let i = 0; i < fillets.length; i++) {
        const f = fillets[i];
        if (
          !Number.isFinite(f.pStart?.x) || !Number.isFinite(f.pStart?.y) ||
          !Number.isFinite(f.pEnd?.x) || !Number.isFinite(f.pEnd?.y) ||
          !Number.isFinite(f.center?.x) || !Number.isFinite(f.center?.y) ||
          !Number.isFinite(f.r) || !Number.isFinite(f.t)
        ) {
          brokenCorner = { index: i, fillet: f };
          break;
        }
      }
    }

    console.warn('corner-bite: Generated path d contains non-finite numbers (NaN/Infinity), returning last valid d', {
      input,
      opts,
      brokenCorner,
      d,
      lastValidPath
    });
    return lastValidPath;
  }

  if (d) {
    lastValidPath = d;
  }
  return d;
}

/**
 * Builds an SVG path string from a polygon or an array of rectangles.
 *
 * @param {Array<import('./types.js').Point> | Array<import('./types.js').Rect> | Array<Array<import('./types.js').Point>>} input
 * @param {import('./types.js').BuildPathOptions} [opts]
 * @returns {string} SVG path string
 */
export function buildPath(input, opts = {}) {
  validateOptions(opts);

  if (!Array.isArray(input)) {
    throw new TypeError(`Input must be an array, got ${typeof input}`);
  }
  if (input.length === 0) {
    return '';
  }

  // Check if input is an array of contours (nested arrays)
  if (Array.isArray(input[0])) {
    const contoursPath = input.map(contour => buildPath(contour, opts)).filter(Boolean).join(' ');
    return checkFiniteAndFallback(contoursPath, input, opts);
  }

  // Check if input is a list of rectangles ({x, y, w, h})
  if (typeof input[0] === 'object' && input[0] !== null && 'w' in input[0] && 'h' in input[0]) {
    return roundedUnion(/** @type {Array<import('./types.js').Rect>} */ (input), opts);
  }

  // Single polygon input
  const vertices = /** @type {Array<import('./types.js').Point>} */ (input);
  validatePolygon(vertices);

  const clean = removeCollinear(ensureClockwise(vertices));
  if (clean.length < 3) {
    throw new RangeError('Polygon must have at least 3 non-collinear vertices');
  }

  const fillets = calculateFillets(clean, opts);
  const precision = opts.precision !== undefined ? opts.precision : 3;
  const d = filletsToPathString(fillets, precision);

  return checkFiniteAndFallback(d, input, opts, fillets);
}

/**
 * Computes the boolean union of rectangles and builds a smoothed SVG path.
 *
 * @param {Array<import('./types.js').Rect>} rects
 * @param {import('./types.js').BuildPathOptions} [opts]
 * @returns {string} SVG path string
 */
export function roundedUnion(rects, opts = {}) {
  validateOptions(opts);
  validateRects(rects);

  const bleed = opts.bleed || 0;
  let processedRects = rects;

  if (bleed > 0) {
    processedRects = rects.map(r => ({
      x: r.x - bleed,
      y: r.y - bleed,
      w: r.w + 2 * bleed,
      h: r.h + 2 * bleed,
    }));
  }

  const contours = unionRects(processedRects);
  if (contours.length === 0) {
    if (rects.length > 0 && lastValidPath) {
      console.warn('corner-bite: roundedUnion produced 0 contours for non-empty rects, returning last valid d', {
        rects,
        opts,
        lastValidPath
      });
      return lastValidPath;
    }
    return '';
  }

  const allFillets = [];
  const parts = contours.map(contour => {
    const fillets = calculateFillets(contour, opts);
    allFillets.push(...fillets);
    const precision = opts.precision !== undefined ? opts.precision : 3;
    return filletsToPathString(fillets, precision);
  });

  const d = parts.join(' ');
  return checkFiniteAndFallback(d, rects, opts, allFillets);
}
