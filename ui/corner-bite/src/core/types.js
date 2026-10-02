/**
 * @typedef {Object} Point
 * @property {number} x
 * @property {number} y
 * @property {number} [r] - Optional per-vertex radius override
 */

/**
 * @typedef {Object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {Object} BuildPathOptions
 * @property {number} [radius=0] - Default radius for convex corners
 * @property {number} [concaveRadius] - Radius for concave corners (defaults to radius)
 * @property {number} [smoothing=0] - Reserved for future continuous squircle curvature (currently no-op)
 * @property {number} [precision=3] - Number of decimal places in path output
 * @property {number} [bleed=0] - Bleed expansion in px before boolean union
 */

export {};
