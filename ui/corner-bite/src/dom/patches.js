import { unionRects } from '../core/union.js';
import { calculateFillets } from '../core/fillet.js';

/**
 * Builds the SVG path 'd' string for concave corner patch overlays.
 *
 * @param {Array<import('../core/types.js').Rect>} rects
 * @param {import('../core/types.js').BuildPathOptions} [options]
 * @param {number} [precision=3]
 * @returns {string} SVG path string containing all patch wedges
 */
export function buildPatchesPath(rects, options = {}, precision = 3) {
  const contours = unionRects(rects);
  if (contours.length === 0) return '';

  const fmt = (n) => Number(n.toFixed(precision)).toString();
  const patchPaths = [];
  const inset = Number(options.patchStrokeInset) || 0;

  for (const contour of contours) {
    const fillets = calculateFillets(contour, options);
    for (const f of fillets) {
      if (!f.isConcave || f.r <= (inset > 0 ? inset : 0)) continue;

      let pStartX = f.pStart.x;
      let pStartY = f.pStart.y;
      let pEndX = f.pEnd.x;
      let pEndY = f.pEnd.y;
      let innerVx = f.vertex.x;
      let innerVy = f.vertex.y;

      if (inset > 0) {
        const len1 = Math.hypot(f.pStart.x - f.vertex.x, f.pStart.y - f.vertex.y) || 1;
        const v1x = (f.pStart.x - f.vertex.x) / len1;
        const v1y = (f.pStart.y - f.vertex.y) / len1;

        const len2 = Math.hypot(f.pEnd.x - f.vertex.x, f.pEnd.y - f.vertex.y) || 1;
        const v2x = (f.pEnd.x - f.vertex.x) / len2;
        const v2y = (f.pEnd.y - f.vertex.y) / len2;

        const vx = f.vertex.x - inset * (v1x + v2x);
        const vy = f.vertex.y - inset * (v1y + v2y);
        pStartX = vx + f.r * v1x;
        pStartY = vy + f.r * v1y;
        pEndX = vx + f.r * v2x;
        pEndY = vy + f.r * v2y;

        // Tuck inner vertex slightly into the solid shapes to eliminate antialiasing hairline seam
        const tuck = 1.5;
        innerVx = vx - tuck * (v1x + v2x);
        innerVy = vy - tuck * (v1y + v2y);
      }

      // Construct patch wedge:
      // Start at pStart, line to sharp inner vertex, line to pEnd,
      // and circular arc back to pStart with opposite sweep (1)
      const p1 = `M ${fmt(pStartX)} ${fmt(pStartY)}`;
      const p2 = `L ${fmt(innerVx)} ${fmt(innerVy)}`;
      const p3 = `L ${fmt(pEndX)} ${fmt(pEndY)}`;
      const arc = `A ${fmt(f.r)} ${fmt(f.r)} 0 0 1 ${fmt(pStartX)} ${fmt(pStartY)} Z`;

      patchPaths.push(`${p1} ${p2} ${p3} ${arc}`);
    }
  }

  return patchPaths.join(' ');
}

/**
 * Builds the SVG path 'd' string for concave corner patch stroke arcs only.
 *
 * @param {Array<import('../core/types.js').Rect>} rects
 * @param {import('../core/types.js').BuildPathOptions} [options]
 * @param {number} [precision=3]
 * @returns {string} SVG path string containing all patch arc strokes
 */
export function buildPatchesArcPath(rects, options = {}, precision = 3) {
  const contours = unionRects(rects);
  if (contours.length === 0) return '';

  const fmt = (n) => Number(n.toFixed(precision)).toString();
  const arcPaths = [];
  const inset = Number(options.patchStrokeInset) || 0;
  const ext = Number(options.patchStrokeExtension) || 0;

  for (const contour of contours) {
    const fillets = calculateFillets(contour, options);
    for (const f of fillets) {
      if (!f.isConcave || f.r <= (inset > 0 ? inset : 0)) continue;

      let pStartX = f.pStart.x;
      let pStartY = f.pStart.y;
      let pEndX = f.pEnd.x;
      let pEndY = f.pEnd.y;
      let v1x = 1;
      let v1y = 0;
      let v2x = 0;
      let v2y = 1;

      if (inset > 0 || ext > 0) {
        const len1 = Math.hypot(f.pStart.x - f.vertex.x, f.pStart.y - f.vertex.y) || 1;
        v1x = (f.pStart.x - f.vertex.x) / len1;
        v1y = (f.pStart.y - f.vertex.y) / len1;

        const len2 = Math.hypot(f.pEnd.x - f.vertex.x, f.pEnd.y - f.vertex.y) || 1;
        v2x = (f.pEnd.x - f.vertex.x) / len2;
        v2y = (f.pEnd.y - f.vertex.y) / len2;

        const vx = f.vertex.x - inset * (v1x + v2x);
        const vy = f.vertex.y - inset * (v1y + v2y);
        pStartX = vx + f.r * v1x;
        pStartY = vy + f.r * v1y;
        pEndX = vx + f.r * v2x;
        pEndY = vy + f.r * v2y;
      }

      if (ext > 0) {
        const extStartX = pStartX + ext * v1x;
        const extStartY = pStartY + ext * v1y;
        const extEndX = pEndX + ext * v2x;
        const extEndY = pEndY + ext * v2y;

        const p1 = `M ${fmt(extEndX)} ${fmt(extEndY)}`;
        const l1 = `L ${fmt(pEndX)} ${fmt(pEndY)}`;
        const arc = `A ${fmt(f.r)} ${fmt(f.r)} 0 0 1 ${fmt(pStartX)} ${fmt(pStartY)}`;
        const l2 = `L ${fmt(extStartX)} ${fmt(extStartY)}`;

        arcPaths.push(`${p1} ${l1} ${arc} ${l2}`);
      } else {
        // Arc curves from pEnd to pStart with sweep 1 (along the concave fillet boundary)
        const p1 = `M ${fmt(pEndX)} ${fmt(pEndY)}`;
        const arc = `A ${fmt(f.r)} ${fmt(f.r)} 0 0 1 ${fmt(pStartX)} ${fmt(pStartY)}`;

        arcPaths.push(`${p1} ${arc}`);
      }
    }
  }

  return arcPaths.join(' ');
}

/**
 * Resolves the solid fill color for patches.
 *
 * @param {HTMLElement[]} elements
 * @param {string} [patchColor]
 * @returns {string}
 */
export function resolvePatchColor(elements, patchColor) {
  if (patchColor) return patchColor;
  if (typeof window !== 'undefined' && elements && elements[0]) {
    try {
      const bg = window.getComputedStyle(elements[0]).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        return bg;
      }
    } catch {
      // Fallback
    }
  }
  return 'currentColor';
}
