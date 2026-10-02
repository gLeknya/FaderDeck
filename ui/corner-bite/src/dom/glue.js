import { joinShapes } from './joinShapes.js';

/**
 * Automatically discovers elements with [data-concave-part] within a container
 * and joins them using joinShapes.
 *
 * @param {HTMLElement | string} containerOrSelector
 * @param {Object} [options]
 * @returns {{
 *   update: () => void,
 *   setRadius: (r: number, concaveR?: number) => void,
 *   getPath: () => string,
 *   destroy: () => void,
 *   refresh: () => void,
 *   container: HTMLElement | null,
 *   elements: HTMLElement[],
 *   controller: any
 * }}
 */
export function glue(containerOrSelector, options = {}) {
  let container = null;
  if (typeof containerOrSelector === 'string') {
    container = typeof document !== 'undefined' ? document.querySelector(containerOrSelector) : null;
  } else {
    container = containerOrSelector;
  }

  if (!container || typeof container !== 'object') {
    throw new TypeError('glue requires a valid container element or selector');
  }

  let currentController = null;
  let currentElements = [];
  let isDestroyed = false;

  const scanAndJoin = () => {
    if (isDestroyed) return;

    if (currentController) {
      currentController.destroy();
      currentController = null;
    }

    const parts = Array.from(container.querySelectorAll('[data-concave-part]'));
    currentElements = parts;

    if (parts.length === 0) {
      return;
    }

    // Check optional data-concave-radius on container or parts
    const containerRadiusAttr = container.getAttribute('data-concave-radius');
    const defaultRadius = containerRadiusAttr ? parseFloat(containerRadiusAttr) : options.radius;

    const mergedOptions = {
      ...options,
      radius: defaultRadius ?? options.radius ?? 0,
    };

    currentController = joinShapes(parts, mergedOptions);
  };

  scanAndJoin();

  return {
    update() {
      if (currentController) currentController.update();
    },

    setRadius(r, concaveR) {
      if (currentController) currentController.setRadius(r, concaveR);
    },

    getPath() {
      return currentController ? currentController.getPath() : '';
    },

    refresh() {
      scanAndJoin();
    },

    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      if (currentController) {
        currentController.destroy();
        currentController = null;
      }
      currentElements = [];
    },

    container,

    get elements() {
      return currentElements;
    },

    get controller() {
      return currentController;
    }
  };
}
