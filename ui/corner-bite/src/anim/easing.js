/**
 * Easing functions for corner-bite animations.
 */
export const easings = {
  linear: (t) => t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

/**
 * Resolves an easing function from name or function.
 * @param {string | ((t: number) => number)} [easing='easeInOutCubic']
 * @returns {(t: number) => number}
 */
export function getEasing(easing = 'easeInOutCubic') {
  if (typeof easing === 'function') return easing;
  const fn = easings[easing];
  if (!fn) {
    throw new TypeError(`Unknown easing '${easing}'. Available: ${Object.keys(easings).join(', ')}`);
  }
  return fn;
}
