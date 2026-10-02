/**
 * Validates options for path generation.
 * @param {import('./types.js').BuildPathOptions} [opts]
 */
export function validateOptions(opts = {}) {
  if (opts.radius !== undefined) {
    if (typeof opts.radius !== 'number' || Number.isNaN(opts.radius)) {
      throw new TypeError(`Option 'radius' must be a valid number, got ${opts.radius}`);
    }
    if (opts.radius < 0) {
      throw new RangeError(`Option 'radius' cannot be negative, got ${opts.radius}`);
    }
  }

  if (opts.concaveRadius !== undefined) {
    if (typeof opts.concaveRadius !== 'number' || Number.isNaN(opts.concaveRadius)) {
      throw new TypeError(`Option 'concaveRadius' must be a valid number, got ${opts.concaveRadius}`);
    }
    if (opts.concaveRadius < 0) {
      throw new RangeError(`Option 'concaveRadius' cannot be negative, got ${opts.concaveRadius}`);
    }
  }

  if (opts.precision !== undefined) {
    if (typeof opts.precision !== 'number' || Number.isNaN(opts.precision) || opts.precision < 0) {
      throw new TypeError(`Option 'precision' must be a non-negative number, got ${opts.precision}`);
    }
  }

  if (opts.bleed !== undefined) {
    if (typeof opts.bleed !== 'number' || Number.isNaN(opts.bleed) || opts.bleed < 0) {
      throw new TypeError(`Option 'bleed' must be a non-negative number, got ${opts.bleed}`);
    }
  }
}

/**
 * Validates a polygon vertices array.
 * @param {Array<import('./types.js').Point>} vertices
 */
export function validatePolygon(vertices) {
  if (!Array.isArray(vertices)) {
    throw new TypeError(`Vertices must be an array, got ${typeof vertices}`);
  }
  if (vertices.length < 3) {
    throw new RangeError(`Polygon must have at least 3 vertices, got ${vertices.length}`);
  }

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (!v || typeof v !== 'object') {
      throw new TypeError(`Vertex at index ${i} must be an object {x, y}`);
    }
    if (typeof v.x !== 'number' || Number.isNaN(v.x) || !Number.isFinite(v.x)) {
      throw new TypeError(`Vertex at index ${i} has invalid x: ${v.x}`);
    }
    if (typeof v.y !== 'number' || Number.isNaN(v.y) || !Number.isFinite(v.y)) {
      throw new TypeError(`Vertex at index ${i} has invalid y: ${v.y}`);
    }
    if (v.r !== undefined) {
      if (typeof v.r !== 'number' || Number.isNaN(v.r)) {
        throw new TypeError(`Vertex at index ${i} has invalid radius override: ${v.r}`);
      }
      if (v.r < 0) {
        throw new RangeError(`Vertex at index ${i} radius cannot be negative: ${v.r}`);
      }
    }
  }
}

/**
 * Validates an array of rectangles.
 * @param {Array<import('./types.js').Rect>} rects
 */
export function validateRects(rects) {
  if (!Array.isArray(rects)) {
    throw new TypeError(`Rectangles must be an array, got ${typeof rects}`);
  }
  if (rects.length === 0) {
    throw new RangeError('Rectangle array cannot be empty');
  }

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r || typeof r !== 'object') {
      throw new TypeError(`Rectangle at index ${i} must be an object {x, y, w, h}`);
    }
    if (typeof r.x !== 'number' || Number.isNaN(r.x) || !Number.isFinite(r.x)) {
      throw new TypeError(`Rectangle at index ${i} has invalid x: ${r.x}`);
    }
    if (typeof r.y !== 'number' || Number.isNaN(r.y) || !Number.isFinite(r.y)) {
      throw new TypeError(`Rectangle at index ${i} has invalid y: ${r.y}`);
    }
    if (typeof r.w !== 'number' || Number.isNaN(r.w) || !Number.isFinite(r.w) || r.w <= 0) {
      throw new RangeError(`Rectangle at index ${i} width must be a positive finite number, got ${r.w}`);
    }
    if (typeof r.h !== 'number' || Number.isNaN(r.h) || !Number.isFinite(r.h) || r.h <= 0) {
      throw new RangeError(`Rectangle at index ${i} height must be a positive finite number, got ${r.h}`);
    }
  }
}
