/**
 * Compares two geometries (arrays of rects or vertices) with a numerical tolerance.
 *
 * @param {any[]} a
 * @param {any[]} b
 * @param {number} [tol=1e-3]
 * @returns {boolean} true if geometries are equal within tolerance
 */
export function areGeometriesEqual(a, b, tol = 1e-3) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const itemA = a[i];
    const itemB = b[i];
    if (!itemA || !itemB) return false;

    if (Math.abs(itemA.x - itemB.x) > tol) return false;
    if (Math.abs(itemA.y - itemB.y) > tol) return false;

    if ('w' in itemA && 'w' in itemB) {
      if (Math.abs(itemA.w - itemB.w) > tol) return false;
      if (Math.abs(itemA.h - itemB.h) > tol) return false;
    }
    if ('r' in itemA || 'r' in itemB) {
      const ra = itemA.r || 0;
      const rb = itemB.r || 0;
      if (Math.abs(ra - rb) > tol) return false;
    }
  }

  return true;
}

/**
 * Checks if a DOM element or container is currently hidden or detached.
 * @param {any} el
 * @returns {boolean}
 */
export function isElementHidden(el) {
  if (!el || typeof el !== 'object') return false;
  if (typeof document !== 'undefined' && document.hidden) return true;
  if ('isConnected' in el && !el.isConnected) return true;
  if (typeof el.getClientRects === 'function') {
    return el.getClientRects().length === 0;
  }
  return false;
}

/**
 * Creates a frame scheduler for corner-bite updates.
 *
 * @param {Object} [deps]
 * @param {(cb: FrameRequestCallback) => number} [deps.raf]
 * @param {(id: number) => void} [deps.cancelRaf]
 * @param {() => number} [deps.now]
 */
export function createScheduler(deps = {}) {
  const raf = deps.raf || (
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16)
  );

  const cancelRaf = deps.cancelRaf || (
    typeof cancelAnimationFrame !== 'undefined'
      ? cancelAnimationFrame
      : clearTimeout
  );

  /** @type {Map<any, {
   *   render: () => void,
   *   geometry: any,
   *   element: any,
   *   force: boolean
   * }>} */
  const tasks = new Map();
  const lastGeometries = new Map();
  let rafId = null;

  const flush = () => {
    rafId = null;
    const entries = Array.from(tasks.entries());
    tasks.clear();

    for (const [key, task] of entries) {
      // 1. Skip if element is hidden and not forced
      if (!task.force && isElementHidden(task.element)) {
        // Keep pending for next visibility
        tasks.set(key, { ...task, force: true });
        continue;
      }

      // 2. Skip if geometry hasn't changed within tolerance
      const lastGeo = lastGeometries.get(key);
      if (!task.force && lastGeo && areGeometriesEqual(task.geometry, lastGeo)) {
        continue;
      }

      // 3. Recalculate
      task.render();
      if (task.geometry) {
        lastGeometries.set(key, task.geometry);
      }
    }
  };

  // Listen to document visibility change
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && tasks.size > 0 && rafId === null) {
        rafId = raf(flush);
      }
    });
  }

  return {
    /**
     * Schedules an update for a shape. Deduplicates multiple calls in the same frame.
     * @param {any} key - Unique identifier for the shape/controller
     * @param {() => void} render - Render callback
     * @param {any} [geometry] - Geometry to check for dirty state
     * @param {any} [element] - Associated DOM element to check visibility
     * @param {boolean} [force=false]
     */
    schedule(key, render, geometry = null, element = null, force = false) {
      const existing = tasks.get(key);
      tasks.set(key, {
        render,
        geometry,
        lastRenderedGeometry: existing ? existing.lastRenderedGeometry : null,
        element: element || existing?.element || null,
        force: force || existing?.force || false,
      });

      if (rafId === null) {
        rafId = raf(flush);
      }
    },

    /**
     * Cancels any pending scheduled update for a key.
     * @param {any} key
     */
    cancel(key) {
      tasks.delete(key);
      lastGeometries.delete(key);
      if (tasks.size === 0 && rafId !== null) {
        cancelRaf(rafId);
        rafId = null;
      }
    },

    /**
     * Immediately executes all pending tasks.
     */
    flushSync() {
      if (rafId !== null) {
        cancelRaf(rafId);
        rafId = null;
      }
      flush();
    },

    /**
     * Number of pending tasks
     */
    get pendingCount() {
      return tasks.size;
    }
  };
}

export const sharedScheduler = createScheduler();
