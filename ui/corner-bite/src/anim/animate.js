import { getEasing } from './easing.js';

// Map of active animations per shape controller
const activeAnimations = new WeakMap();

/**
 * Interpolates between two geometries (numbers: x, y, w, h, r).
 *
 * @param {any[]} from
 * @param {any[]} to
 * @param {number} progress - [0..1]
 * @returns {any[]}
 */
export function interpolateGeometry(from, to, progress) {
  const result = new Array(to.length);

  for (let i = 0; i < to.length; i++) {
    const f = from[i];
    const t = to[i];

    const item = {
      x: f.x + (t.x - f.x) * progress,
      y: f.y + (t.y - f.y) * progress,
    };

    if ('w' in t && 'w' in f) {
      item.w = f.w + (t.w - f.w) * progress;
      item.h = f.h + (t.h - f.h) * progress;
    }

    if ('r' in t || 'r' in f) {
      const fr = f.r !== undefined ? f.r : 0;
      const tr = t.r !== undefined ? t.r : 0;
      item.r = fr + (tr - fr) * progress;
    }

    result[i] = item;
  }

  return result;
}

/**
 * Animates a corner-bite shape to a target geometry by interpolating numeric values.
 *
 * @param {any} shape - Controller from attach() or joinShapes()
 * @param {any[]} toGeometry - Target array of rects or vertices
 * @param {Object} [options]
 * @param {number} [options.duration=300] - Duration in ms
 * @param {string | ((t: number) => number)} [options.easing='easeInOutCubic']
 * @param {(currentGeometry: any[]) => void} [options.onUpdate]
 * @returns {{
 *   cancel: () => void,
 *   finished: Promise<any[]>
 * }}
 */
export function animate(shape, toGeometry, options = {}) {
  if (!shape || typeof shape.update !== 'function') {
    throw new TypeError('animate requires a valid corner-bite shape controller');
  }

  if (!Array.isArray(toGeometry)) {
    throw new TypeError('toGeometry must be an array of rectangles or vertices');
  }

  // Get current geometry from controller
  const fromGeometry = shape.geometry || (typeof shape.getGeometry === 'function' ? shape.getGeometry() : null);
  if (!fromGeometry || !Array.isArray(fromGeometry)) {
    throw new Error('Shape does not provide a valid current geometry to animate from');
  }

  if (fromGeometry.length !== toGeometry.length) {
    throw new Error(
      `Cannot animate between geometries with different structure (expected ${fromGeometry.length}, got ${toGeometry.length})`
    );
  }

  // Cancel any existing animation on this shape
  const existingAnim = activeAnimations.get(shape);
  if (existingAnim) {
    existingAnim.cancel();
  }

  const duration = options.duration ?? 300;
  const easingFn = getEasing(options.easing || 'easeInOutCubic');
  const onUpdate = options.onUpdate;

  let isCancelled = false;
  let rafId = null;
  const now = options.now || (typeof performance !== 'undefined' && performance.now ? () => performance.now() : Date.now);
  const raf = options.raf || (
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(now()), 16)
  );
  const cancelRaf = options.cancelRaf || (
    typeof cancelAnimationFrame !== 'undefined'
      ? cancelAnimationFrame
      : clearTimeout
  );

  let startTime = null;
  let resolvePromise, rejectPromise;

  const finished = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cancel = () => {
    if (isCancelled) return;
    isCancelled = true;
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    activeAnimations.delete(shape);
    rejectPromise(new Error('Animation cancelled'));
  };

  const tick = (timestamp) => {
    if (isCancelled) return;
    const currentTime = typeof timestamp === 'number' ? timestamp : now();
    if (startTime === null) startTime = currentTime;

    const elapsed = currentTime - startTime;
    const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;
    const easedProgress = easingFn(progress);

    const currentGeo = interpolateGeometry(fromGeometry, toGeometry, easedProgress);
    shape.update(currentGeo);

    if (typeof onUpdate === 'function') {
      onUpdate(currentGeo);
    }

    if (progress >= 1) {
      // Final step: apply exact toGeometry
      shape.update(toGeometry);
      activeAnimations.delete(shape);
      resolvePromise(toGeometry);
    } else {
      rafId = raf(tick);
    }
  };

  const animHandle = { cancel, finished };
  activeAnimations.set(shape, animHandle);

  rafId = raf(tick);

  return animHandle;
}
