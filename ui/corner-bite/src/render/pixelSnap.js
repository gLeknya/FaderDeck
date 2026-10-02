/**
 * Snaps a single numerical value to the nearest physical device pixel (1 / DPR).
 *
 * @param {number} val
 * @param {number} [dpr]
 * @returns {number}
 */
export function snapValue(val, dpr) {
  const ratio = dpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  return Math.round(val * ratio) / ratio;
}

/**
 * Snaps all coordinates in a geometry array to 1 / DPR.
 *
 * @param {any[]} geometry
 * @param {number} [dpr]
 * @returns {any[]}
 */
export function snapGeometry(geometry, dpr) {
  if (!Array.isArray(geometry)) return geometry;
  const ratio = dpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

  return geometry.map(item => {
    if (!item || typeof item !== 'object') return item;
    const snapped = {
      x: snapValue(item.x, ratio),
      y: snapValue(item.y, ratio),
    };
    if ('w' in item) snapped.w = snapValue(item.w, ratio);
    if ('h' in item) snapped.h = snapValue(item.h, ratio);
    if ('r' in item && item.r !== undefined) snapped.r = snapValue(item.r, ratio);
    return snapped;
  });
}

/**
 * Manages pixel snapping with idle debouncing and DPR change listeners.
 *
 * @param {Object} options
 * @param {(snappedGeometry: any[]) => void} options.onSnapRender
 * @param {() => any[]} options.getGeometry
 * @param {number} [options.debounceMs=120]
 */
export function createSnapManager({ onSnapRender, getGeometry, debounceMs = 120 }) {
  let timerId = null;
  let isDestroyed = false;
  let mediaQueryList = null;

  const getDpr = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  const doSnap = () => {
    if (isDestroyed) return;
    const geo = getGeometry();
    if (!geo) return;
    const snapped = snapGeometry(geo, getDpr());
    onSnapRender(snapped);
  };

  const scheduleSnap = () => {
    if (isDestroyed) return;
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      doSnap();
    }, debounceMs);
  };

  // Listen to resolution changes (zoom, screen move)
  const setupResolutionListener = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const updateQuery = () => {
      if (isDestroyed) return;
      const dpr = getDpr();
      mediaQueryList = window.matchMedia(`(resolution: ${dpr}dppx)`);
      mediaQueryList.addEventListener('change', () => {
        doSnap();
        setupResolutionListener();
      }, { once: true });
    };

    updateQuery();
  };

  setupResolutionListener();

  return {
    notifyChange() {
      scheduleSnap();
    },

    forceSnap() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      doSnap();
    },

    destroy() {
      isDestroyed = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      mediaQueryList = null;
    }
  };
}
