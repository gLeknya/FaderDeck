import { findPositionedAncestor } from './ancestor.js';
import { measureRelativeRects } from './measure.js';
import { roundedUnion } from '../core/path.js';
import { createSvgLayer, setPathD } from '../render/svg.js';
import { buildPatchesPath, buildPatchesArcPath, resolvePatchColor } from './patches.js';
import { sharedScheduler } from '../anim/scheduler.js';
import { createSnapManager } from '../render/pixelSnap.js';

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
  const enableSnap = currentOptions.snap !== false;

  const controllerKey = Symbol('joinShapesController');
  let svgObj = null;
  let strokePath = null;
  let currentPathString = '';
  let rafId = null;
  let activeAnimationCount = 0;
  let snapManager = null;
  let lastMeasuredRects = [];

  // Create SVG layer if mode is 'svg' or 'patches'
  if (mode === 'svg' || mode === 'patches') {
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    svgObj = createSvgLayer(doc);

    if (mode === 'patches') {
      const color = resolvePatchColor(elements, currentOptions.patchColor);
      svgObj.path.style.fill = color;
      svgObj.path.style.stroke = 'none';

      if (currentOptions.patchStroke) {
        strokePath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        strokePath.setAttribute('class', 'corner-bite-patch-stroke');
        Object.assign(strokePath.style, {
          fill: 'none',
          stroke: currentOptions.patchStroke,
          strokeWidth: currentOptions.patchStrokeWidth || '1px',
          strokeLinecap: currentOptions.patchStrokeLinecap || 'butt',
        });
        svgObj.svg.appendChild(strokePath);
      }

      // In patches mode, overlay sits on top of elements
      svgObj.svg.style.zIndex = currentOptions.zIndex ? String(currentOptions.zIndex) : '10';
      container.appendChild(svgObj.svg);
    } else {
      if (container.firstChild) {
        container.insertBefore(svgObj.svg, container.firstChild);
      } else {
        container.appendChild(svgObj.svg);
      }
    }
  }

  // Render routine: executes path generation and updates DOM
  const doRender = (rects) => {
    if (isDestroyed || !rects || rects.length === 0) return;
    lastMeasuredRects = rects;

    if (mode === 'patches') {
      currentPathString = buildPatchesPath(rects, currentOptions, currentOptions.precision || 3);
      if (svgObj && svgObj.path) {
        setPathD(svgObj.path, currentPathString);
      }
      if (strokePath) {
        const arcD = buildPatchesArcPath(rects, currentOptions, currentOptions.precision || 3);
        setPathD(strokePath, arcD);
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

  // Schedule update through sharedScheduler
  const scheduleUpdate = () => {
    if (isDestroyed) return;
    const rects = measureRelativeRects(elements, container);
    if (rects.length === 0) return;
    lastMeasuredRects = rects;

    sharedScheduler.schedule(controllerKey, () => doRender(lastMeasuredRects), lastMeasuredRects, container);
    if (snapManager) snapManager.notifyChange();
  };

  // Setup pixelSnap manager (120ms debounce)
  if (enableSnap) {
    snapManager = createSnapManager({
      getGeometry: () => (lastMeasuredRects.length > 0 ? lastMeasuredRects : measureRelativeRects(elements, container)),
      onSnapRender: (snappedGeo) => {
        doRender(snappedGeo);
      },
      debounceMs: 120
    });
  }

  // Follow loop for continuous tracking
  const startFollowLoop = () => {
    if (rafId !== null || isDestroyed) return;
    const tick = () => {
      if (isDestroyed) return;

      let hasRunningAnimations = false;
      const hasWaapi = elements.some(el => typeof el.getAnimations === 'function');
      if (hasWaapi) {
        hasRunningAnimations = elements.some(el => {
          if (typeof el.getAnimations === 'function') {
            return el.getAnimations().some(a => a.playState === 'running');
          }
          return false;
        });
      }

      if (follow === 'always' || hasRunningAnimations || (!hasWaapi && activeAnimationCount > 0)) {
        scheduleUpdate();
        rafId = (typeof requestAnimationFrame === 'function')
          ? requestAnimationFrame(tick)
          : null;
      } else {
        // Animation finished or was aborted; stop RAF loop to avoid sticking
        activeAnimationCount = 0;
        stopFollowLoop();
        scheduleUpdate();
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
      scheduleUpdate();
    });
    for (const el of elements) {
      resizeObserver.observe(el);
    }
    resizeObserver.observe(container);
  }

  // Setup window resize listener
  const onWindowResize = () => scheduleUpdate();
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
    const hasRunning = elements.some(el => {
      if (typeof el.getAnimations === 'function') {
        return el.getAnimations().some(a => a.playState === 'running');
      }
      return false;
    });

    if (!hasRunning && activeAnimationCount === 0 && follow !== 'always') {
      stopFollowLoop();
      scheduleUpdate();
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

  // Initial render is synchronous
  const initialRects = measureRelativeRects(elements, container);
  if (initialRects.length > 0) {
    doRender(initialRects);
  }

  return {
    update(immediate = false) {
      if (isDestroyed) return;
      if (immediate) {
        const rects = measureRelativeRects(elements, container);
        if (rects.length > 0) {
          doRender(rects);
        }
      } else {
        scheduleUpdate();
      }
    },

    setRadius(r, concaveR, immediate = false) {
      if (isDestroyed) return;
      currentOptions.radius = r;
      if (concaveR !== undefined) {
        currentOptions.concaveRadius = concaveR;
      }
      if (immediate) {
        const rects = measureRelativeRects(elements, container);
        if (rects.length > 0) {
          doRender(rects);
        }
      } else {
        scheduleUpdate();
      }
    },

    getPath() {
      return currentPathString;
    },

    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;

      stopFollowLoop();
      sharedScheduler.cancel(controllerKey);

      if (snapManager) {
        snapManager.destroy();
        snapManager = null;
      }

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
