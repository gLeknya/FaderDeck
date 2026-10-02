import { getCornerInfo, getFilletCenter } from './geometry.js';

/**
 * Calculates fillet corners for a polygon, applying proportional auto-limiting
 * to ensure fillets on adjacent corners never overlap.
 *
 * @param {Array<import('./types.js').Point>} vertices - CW oriented vertices
 * @param {import('./types.js').BuildPathOptions} [opts]
 * @returns {Array<{
 *   vertex: import('./types.js').Point,
 *   isConcave: boolean,
 *   r: number,
 *   t: number,
 *   pStart: {x: number, y: number},
 *   pEnd: {x: number, y: number},
 *   center: {x: number, y: number},
 *   sweep: number
 * }>}
 */
export function calculateFillets(vertices, opts = {}) {
  const n = vertices.length;
  if (n < 3) return [];

  const defaultRadius = opts.radius ?? 0;
  const defaultConcaveRadius = opts.concaveRadius ?? defaultRadius;

  // 1. Gather corner info and target radii
  const corners = [];
  const targetRadii = [];
  const targetTangents = [];

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const info = getCornerInfo(prev, curr, next);
    corners.push(info);

    // Vertex-specific radius overrides general options
    let r = curr.r !== undefined
      ? curr.r
      : info.isConcave
        ? defaultConcaveRadius
        : defaultRadius;

    // Tangent distance: t = r / tan(theta / 2)
    let t = (r > 0 && info.tanHalfTheta > 1e-7 && Number.isFinite(info.tanHalfTheta))
      ? r / info.tanHalfTheta
      : 0;

    // Contact continuity: limit concave corner by available contact length.
    // To preserve exact tangency to both edges (even for non-90° corners),
    // clamp tangent distance t, then recompute radius r = t * tan(theta / 2).
    if (info.isConcave && curr.contactLimit !== undefined) {
      if (t > curr.contactLimit) {
        t = Math.max(0, curr.contactLimit);
        r = t * (Number.isFinite(info.tanHalfTheta) ? info.tanHalfTheta : 1);
      }
    }

    if (r < 0 || Number.isNaN(r)) r = 0;
    if (t < 0 || Number.isNaN(t)) t = 0;

    targetRadii.push(r);
    targetTangents.push(t);
  }

  // 2. Auto-limit radii: adjacent fillets share edge length
  // Edge i goes from vertex i to vertex (i + 1)
  const edgeScales = [];
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const edgeLen = corners[i].lenOut;
    const requiredLen = targetTangents[i] + targetTangents[nextIdx];

    if (requiredLen > 0 && edgeLen < requiredLen) {
      edgeScales.push(Math.max(0, edgeLen / requiredLen));
    } else {
      edgeScales.push(1);
    }
  }

  // Scale each vertex by the minimum scale factor of its two adjacent edges
  const vertexScales = [];
  for (let i = 0; i < n; i++) {
    const prevEdgeIdx = (i - 1 + n) % n;
    const currEdgeIdx = i;
    const scale = Math.min(1, edgeScales[prevEdgeIdx], edgeScales[currEdgeIdx]);
    vertexScales.push(scale);
  }

  // 3. Compute final fillet endpoints and center
  const result = [];
  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const info = corners[i];
    const scale = vertexScales[i];

    const rEff = targetRadii[i] * scale;
    const tEff = targetTangents[i] * scale;

    const pStart = {
      x: curr.x + tEff * info.u1.x,
      y: curr.y + tEff * info.u1.y,
    };
    const pEnd = {
      x: curr.x + tEff * info.u2.x,
      y: curr.y + tEff * info.u2.y,
    };

    // Center of circular arc
    const center = getFilletCenter(pStart, info.inDir, rEff, info.isConcave);

    // Convex: sweep = 1, Concave: sweep = 0 (in screen coords, CW winding)
    const sweep = info.isConcave ? 0 : 1;

    result.push({
      vertex: curr,
      isConcave: info.isConcave,
      r: rEff,
      t: tEff,
      pStart,
      pEnd,
      center,
      sweep,
    });
  }

  return result;
}

/**
 * Builds an SVG path `d` string with a fixed command structure:
 * M pEnd_{n-1} [L pStart_i A r_i r_i 0 0 sweep_i pEnd_i] * n Z
 *
 * @param {Array<{
 *   r: number,
 *   sweep: number,
 *   pStart: {x: number, y: number},
 *   pEnd: {x: number, y: number}
 * }>} fillets
 * @param {number} [precision=3]
 * @returns {string}
 */
export function filletsToPathString(fillets, precision = 3) {
  const n = fillets.length;
  if (n === 0) return '';

  const fmt = (val) => {
    const fixed = val.toFixed(precision);
    // Remove unnecessary trailing zeroes after decimal point
    return Number(fixed).toString();
  };

  const lastFillet = fillets[n - 1];
  const parts = [`M ${fmt(lastFillet.pEnd.x)} ${fmt(lastFillet.pEnd.y)}`];

  for (let i = 0; i < n; i++) {
    const f = fillets[i];
    parts.push(
      `L ${fmt(f.pStart.x)} ${fmt(f.pStart.y)}`,
      `A ${fmt(f.r)} ${fmt(f.r)} 0 0 ${f.sweep} ${fmt(f.pEnd.x)} ${fmt(f.pEnd.y)}`
    );
  }

  parts.push('Z');
  return parts.join(' ');
}
