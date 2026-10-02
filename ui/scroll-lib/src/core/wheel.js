/**
 * Line height and page height constants for deltaMode conversion.
 */
const LINE_HEIGHT = 40;  // typical line height in px
const PAGE_FACTOR = 0.8; // fraction of viewport for page scroll

/**
 * Normalize wheel delta to pixels.
 * @param {number} delta
 * @param {number} deltaMode - 0=pixel, 1=line, 2=page
 * @param {number} viewportSize - for page mode
 * @returns {number} delta in pixels
 */
export function normalizeDelta(delta, deltaMode, viewportSize) {
  if (deltaMode === 1) return delta * LINE_HEIGHT;
  if (deltaMode === 2) return delta * viewportSize * PAGE_FACTOR;
  return delta;
}

/**
 * Decide what to do with a wheel event.
 * @param {object} input
 * @param {number} input.deltaX - raw deltaX
 * @param {number} input.deltaY - raw deltaY
 * @param {number} input.deltaMode
 * @param {boolean} input.ctrlKey
 * @param {boolean} input.shiftKey
 * @param {'shift'|'always'|'auto'} input.horizontalWheel - mode
 * @param {boolean} input.hasX - axis includes x
 * @param {boolean} input.hasY - axis includes y  
 * @param {number} input.scrollLeft - current
 * @param {number} input.maxScrollX - max scrollLeft
 * @param {number} input.scrollTop - current
 * @param {number} input.maxScrollY - max scrollTop
 * @param {number} input.viewportWidth
 * @param {number} input.viewportHeight
 * @returns {{ handled: boolean, dx: number, dy: number }}
 */
export function decideWheel(input) {
  // Never intercept: ctrlKey (zoom)
  if (input.ctrlKey) return { handled: false, dx: 0, dy: 0 };
  
  // Normalize deltas
  const rawDX = normalizeDelta(input.deltaX, input.deltaMode, input.viewportWidth);
  const rawDY = normalizeDelta(input.deltaY, input.deltaMode, input.viewportHeight);
  
  // If it's a horizontal gesture (trackpad): |deltaX| >= |deltaY| - don't intercept
  if (Math.abs(rawDX) >= Math.abs(rawDY) && rawDX !== 0) {
    return { handled: false, dx: 0, dy: 0 };
  }
  
  // shiftKey: browser converts to horizontal natively - don't intercept
  if (input.shiftKey) return { handled: false, dx: 0, dy: 0 };
  
  // Mode 'shift': never intercept vertical wheel for horizontal
  if (input.horizontalWheel === 'shift') return { handled: false, dx: 0, dy: 0 };
  
  // Must have X axis
  if (!input.hasX) return { handled: false, dx: 0, dy: 0 };
  
  // Mode 'auto': only intercept if no vertical overflow
  if (input.horizontalWheel === 'auto' && input.hasY && input.maxScrollY > 0.5) {
    return { handled: false, dx: 0, dy: 0 };
  }
  
  // Mode 'always' or ('auto' without vertical overflow):
  // Convert vertical wheel to horizontal scroll
  // But only if the element can actually scroll in that direction (prevent page sticking)
  const dx = rawDY; // vertical delta becomes horizontal
  
  // Check if can scroll in the direction
  if (dx > 0 && input.scrollLeft >= input.maxScrollX - 0.5) {
    // At right edge, scrolling right - let event pass through
    return { handled: false, dx: 0, dy: 0 };
  }
  if (dx < 0 && input.scrollLeft <= 0.5) {
    // At left edge, scrolling left - let event pass through
    return { handled: false, dx: 0, dy: 0 };
  }
  
  return { handled: true, dx, dy: 0 };
}
