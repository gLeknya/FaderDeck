/**
 * Batch measures element bounding rectangles relative to a container ancestor.
 *
 * @param {Array<HTMLElement | SVGElement>} elements
 * @param {HTMLElement | SVGElement} container
 * @returns {Array<import('../core/types.js').Rect>}
 */
export function measureRelativeRects(elements, container) {
  if (!container || !elements || elements.length === 0) return [];

  const containerRect = container.getBoundingClientRect();
  const scrollLeft = container.scrollLeft || 0;
  const scrollTop = container.scrollTop || 0;
  const clientLeft = container.clientLeft || 0;
  const clientTop = container.clientTop || 0;

  // Batch read all bounding client rects in one pass
  const rects = elements.map(el => el.getBoundingClientRect());

  // Batch transform to container coordinates, filtering out collapsed/zero-sized elements
  return rects
    .map(r => ({
      x: r.left - containerRect.left + scrollLeft - clientLeft,
      y: r.top - containerRect.top + scrollTop - clientTop,
      w: r.width,
      h: r.height,
    }))
    .filter(r => r.w > 0 && r.h > 0);
}
