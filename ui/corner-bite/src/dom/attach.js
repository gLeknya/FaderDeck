import { buildPath } from '../core/path.js';
import { createSvgLayer, setPathD } from '../render/svg.js';
import { createSnapManager } from '../render/pixelSnap.js';
import { sharedScheduler } from '../anim/scheduler.js';

/**
 * Attaches a corner-bite rounded shape to a DOM element.
 *
 * @param {HTMLElement | SVGElement} el - Host element
 * @param {Object} [options]
 * @param {Array<import('../core/types.js').Rect> | Array<import('../core/types.js').Point>} [options.rects]
 * @param {Array<import('../core/types.js').Point>} [options.vertices]
 * @param {number} [options.radius=0]
 * @param {number} [options.concaveRadius]
 * @param {'svg' | 'clip'} [options.mode='svg']
 * @param {boolean} [options.snap=true]
 * @param {number} [options.bleed=0]
 * @param {number} [options.precision=3]
 * @param {number} [options.smoothing=0]
 * @returns {{
 *   update: (geometry: any) => void,
 *   setRadius: (r: number, concaveR?: number) => void,
 *   getPath: () => string,
 *   destroy: () => void,
 *   geometry: any[],
 *   getGeometry: () => any[],
 *   svgElement?: SVGSVGElement,
 *   pathElement?: SVGPathElement
 * }}
 */
export function attach(el, options = {}) {
  if (!el || typeof el !== 'object' || !('nodeType' in el)) {
    throw new TypeError('attach requires a valid DOM element');
  }

  let isDestroyed = false;
  let currentGeometry = options.rects || options.vertices || [];
  let currentOptions = { ...options };
  const mode = options.mode || 'svg';
  const enableSnap = options.snap !== false;

  let svgObj = null;
  let currentPathString = '';
  let snapManager = null;

  // Check positioned ancestor styling
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'static') {
        console.warn('corner-bite: Host element is position: static. Absolute SVG layer may not align properly.');
      }
    } catch {
      // Ignore in non-browser or mock environments
    }
  }

  if (mode === 'svg') {
    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    svgObj = createSvgLayer(doc);
    if (el.firstChild) {
      el.insertBefore(svgObj.svg, el.firstChild);
    } else {
      el.appendChild(svgObj.svg);
    }
  }

  const controllerKey = Symbol('attachController');

  const doRender = (geo = currentGeometry) => {
    if (isDestroyed) return;
    currentPathString = buildPath(geo, currentOptions);

    if (mode === 'clip') {
      el.style.clipPath = currentPathString ? `path('${currentPathString}')` : '';
    } else if (svgObj && svgObj.path) {
      setPathD(svgObj.path, currentPathString);
    }
  };

  const scheduleUpdate = (newGeometry) => {
    if (isDestroyed) return;
    if (newGeometry) currentGeometry = newGeometry;
    sharedScheduler.schedule(controllerKey, () => doRender(currentGeometry), currentGeometry, el);
    if (snapManager) snapManager.notifyChange();
  };

  if (enableSnap) {
    snapManager = createSnapManager({
      getGeometry: () => currentGeometry,
      onSnapRender: (snappedGeo) => {
        doRender(snappedGeo);
      },
      debounceMs: 120
    });
  }

  // Initial render is synchronous
  if (currentGeometry && currentGeometry.length > 0) {
    doRender();
  }

  return {
    update(newGeometry) {
      if (isDestroyed) return;
      scheduleUpdate(newGeometry);
    },

    setRadius(r, concaveR) {
      if (isDestroyed) return;
      currentOptions.radius = r;
      if (concaveR !== undefined) {
        currentOptions.concaveRadius = concaveR;
      }
      scheduleUpdate();
    },

    getPath() {
      return currentPathString;
    },

    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;

      sharedScheduler.cancel(controllerKey);

      if (snapManager) {
        snapManager.destroy();
        snapManager = null;
      }

      if (mode === 'clip') {
        el.style.clipPath = '';
      } else if (svgObj && svgObj.svg) {
        if (svgObj.svg.parentNode) {
          svgObj.svg.parentNode.removeChild(svgObj.svg);
        }
      }
      svgObj = null;
    },

    get geometry() {
      return currentGeometry;
    },

    getGeometry() {
      return currentGeometry;
    },

    get svgElement() {
      return svgObj?.svg;
    },

    get pathElement() {
      return svgObj?.path;
    }
  };
}
