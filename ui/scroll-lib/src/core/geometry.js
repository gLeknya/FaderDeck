/**
 * Compute scrollbar geometry for one axis.
 * @param {{ viewport: number, content: number, scroll: number, track: number, minThumb: number }} input
 * @returns {{ maxScroll: number, scrollable: boolean, size: number, offset: number }}
 */
export function computeGeometry({ viewport, content, scroll, track, minThumb }) {
  const maxScroll = Math.max(0, content - viewport);
  const scrollable = maxScroll > 0.5; // epsilon for fractional sizes & zoom
  
  // size: proportional, clamped to [min(minThumb, track), track]
  const rawSize = track * viewport / content;
  const lower = Math.min(minThumb, track);
  const size = Math.max(lower, Math.min(rawSize, track));
  
  // offset: position along the track
  let offset = 0;
  if (scrollable) {
    const ratio = Math.max(0, Math.min(scroll / maxScroll, 1)); // clamp for Safari overscroll
    offset = ratio * (track - size);
  }
  
  return { maxScroll, scrollable, size, offset };
}

/**
 * Inverse: given an offset on the track, compute scrollTop/scrollLeft.
 * Used for drag operations.
 * @param {{ offset: number, track: number, size: number, maxScroll: number }} input
 * @returns {number} scroll position
 */
export function scrollFromOffset({ offset, track, size, maxScroll }) {
  const range = track - size;
  if (range <= 0) return 0;
  return (offset / range) * maxScroll;
}
