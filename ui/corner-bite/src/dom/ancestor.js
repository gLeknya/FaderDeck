/**
 * Finds the nearest common ancestor of a list of elements.
 *
 * @param {Array<HTMLElement | SVGElement>} elements
 * @returns {HTMLElement | null}
 */
export function findCommonAncestor(elements) {
  if (!elements || elements.length === 0) return null;
  if (elements.length === 1) return elements[0].parentElement || elements[0];

  // Build parent chain for first element
  const chains = elements.map(el => {
    const chain = [];
    let curr = el;
    while (curr) {
      chain.unshift(curr);
      curr = curr.parentElement;
    }
    return chain;
  });

  let common = null;
  const minLen = Math.min(...chains.map(c => c.length));

  for (let i = 0; i < minLen; i++) {
    const candidate = chains[0][i];
    if (chains.every(c => c[i] === candidate)) {
      common = candidate;
    } else {
      break;
    }
  }

  return common;
}

/**
 * Finds the nearest common positioned ancestor for elements.
 * If the common ancestor is not positioned, logs a warning and returns it.
 *
 * @param {Array<HTMLElement | SVGElement>} elements
 * @returns {HTMLElement | null}
 */
export function findPositionedAncestor(elements) {
  let common = findCommonAncestor(elements);
  if (!common) return null;

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    let curr = common;
    let isPositioned = false;

    // Check if common ancestor or its parents are positioned
    while (curr && curr !== document.documentElement) {
      try {
        const pos = window.getComputedStyle(curr).position;
        if (pos && pos !== 'static') {
          isPositioned = true;
          break;
        }
      } catch {
        break;
      }
      curr = curr.parentElement;
    }

    if (!isPositioned) {
      console.warn('corner-bite: Common ancestor is not positioned (position should be relative, absolute, fixed, or sticky).');
    }
  }

  return common;
}
