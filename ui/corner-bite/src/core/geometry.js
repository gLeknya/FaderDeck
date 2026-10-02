/**
 * Calculates the signed area of a 2D polygon.
 * Positive for Clockwise in screen coordinates (y-down).
 * @param {Array<import('./types.js').Point>} vertices
 * @returns {number}
 */
export function polygonArea(vertices) {
  const n = vertices.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
  }
  return area2 / 2;
}

/**
 * Ensures vertices are ordered Clockwise (in screen coords, y down).
 * @param {Array<import('./types.js').Point>} vertices
 * @returns {Array<import('./types.js').Point>}
 */
export function ensureClockwise(vertices) {
  const area = polygonArea(vertices);
  if (area < 0) {
    return [...vertices].reverse();
  }
  return [...vertices];
}

/**
 * Removes collinear vertices from a closed polygon.
 * @param {Array<import('./types.js').Point>} vertices
 * @param {number} [eps=1e-8]
 * @returns {Array<import('./types.js').Point>}
 */
export function removeCollinear(vertices, eps = 1e-8) {
  if (vertices.length <= 3) return [...vertices];

  let current = [...vertices];
  let changed = true;

  while (changed && current.length > 3) {
    changed = false;
    const nextList = [];
    const n = current.length;

    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n];
      const curr = current[i];
      const next = current[(i + 1) % n];

      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;

      const cross = v1x * v2y - v1y * v2x;
      const dot = v1x * v2x + v1y * v2y;

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);

      // If vertex is redundant: same direction and collinear
      if (Math.abs(cross) <= eps * (len1 * len2 + 1) && dot > 0) {
        changed = true;
        // Skip curr
      } else {
        nextList.push(curr);
      }
    }
    current = nextList;
  }

  return current;
}

/**
 * Calculates corner geometry for a vertex in a CW polygon.
 * @param {import('./types.js').Point} prev
 * @param {import('./types.js').Point} curr
 * @param {import('./types.js').Point} next
 */
export function getCornerInfo(prev, curr, next) {
  const inVx = curr.x - prev.x;
  const inVy = curr.y - prev.y;
  const outVx = next.x - curr.x;
  const outVy = next.y - curr.y;

  const lenIn = Math.hypot(inVx, inVy);
  const lenOut = Math.hypot(outVx, outVy);

  if (lenIn === 0 || lenOut === 0) {
    return {
      isConcave: false,
      theta: Math.PI,
      tanHalfTheta: 0,
      u1: { x: 0, y: 0 },
      u2: { x: 0, y: 0 },
      inDir: { x: 1, y: 0 },
      lenIn: lenIn || 0,
      lenOut: lenOut || 0,
    };
  }

  // Cross product in screen coordinates (y-down)
  // cp > 0: turns right (CW) -> CONVEX
  // cp < 0: turns left (CCW) -> CONCAVE
  const cp = inVx * outVy - inVy * outVx;
  const isConcave = cp < -1e-9;

  // Rays pointing away from curr:
  // u1: back along incoming edge towards prev
  const u1x = -inVx / lenIn;
  const u1y = -inVy / lenIn;

  // u2: forward along outgoing edge towards next
  const u2x = outVx / lenOut;
  const u2y = outVy / lenOut;

  // Dot product between u1 and u2 gives cos(theta) where theta is angle between the two rays
  const cosTheta = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
  const theta = Math.acos(cosTheta);

  // For 90-degree corners, tan(theta / 2) is exactly 1
  let tanHalfTheta;
  if (Math.abs(cosTheta) < 1e-11) {
    tanHalfTheta = 1;
  } else {
    tanHalfTheta = Math.tan(theta / 2);
  }

  return {
    isConcave,
    theta,
    tanHalfTheta,
    u1: { x: u1x, y: u1y },
    u2: { x: u2x, y: u2y },
    inDir: { x: inVx / lenIn, y: inVy / lenIn },
    lenIn,
    lenOut,
  };
}

/**
 * Calculates the center of a fillet arc.
 * @param {import('./types.js').Point} pStart
 * @param {{x: number, y: number}} inDir
 * @param {number} r
 * @param {boolean} isConcave
 * @returns {{x: number, y: number}}
 */
export function getFilletCenter(pStart, inDir, r, isConcave) {
  const dirX = (inDir && Number.isFinite(inDir.x)) ? inDir.x : 1;
  const dirY = (inDir && Number.isFinite(inDir.y)) ? inDir.y : 0;
  const radius = Number.isFinite(r) ? r : 0;

  // Inward normal for CW polygon: (-dirY, dirX)
  // Outward normal: (dirY, -dirX)
  if (isConcave) {
    return {
      x: pStart.x + radius * dirY,
      y: pStart.y - radius * dirX,
    };
  }
  return {
    x: pStart.x - radius * dirY,
    y: pStart.y + radius * dirX,
  };
}
