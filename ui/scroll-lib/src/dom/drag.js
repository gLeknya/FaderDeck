/**
 * Drag handling for scrollbar thumb and track click.
 * Uses Pointer Events + setPointerCapture for reliable drag.
 */

export function createDrag(trackEl, thumbEl, axis, callbacks, opts) {
  let dragging = false;
  let startPointer = 0;
  let startOffset = 0;
  
  // Thumb drag
  const onPointerDown = (e) => {
    if (e.button !== 0) return; // left click only
    e.preventDefault();
    e.stopPropagation();
    
    dragging = true;
    thumbEl.setPointerCapture(e.pointerId);
    
    const rect = thumbEl.getBoundingClientRect();
    startPointer = axis === 'y' ? e.clientY : e.clientX;
    startOffset = axis === 'y' ? rect.top : rect.left;
    
    callbacks.onDragStart();
  };
  
  const onPointerMove = (e) => {
    if (!dragging) return;
    
    const trackRect = trackEl.getBoundingClientRect();
    const pointer = axis === 'y' ? e.clientY : e.clientX;
    const trackStart = axis === 'y' ? trackRect.top : trackRect.left;
    const trackLength = axis === 'y' ? trackRect.height : trackRect.width;
    const thumbSize = callbacks.getThumbSize();
    
    // Calculate offset within track
    const offset = Math.max(0, Math.min(
      pointer - trackStart - (thumbSize / 2),
      trackLength - thumbSize
    ));
    
    callbacks.onDrag(offset, trackLength);
  };
  
  const onPointerUp = (e) => {
    if (!dragging) return;
    dragging = false;
    callbacks.onDragEnd();
  };
  
  // Track click (not on thumb)
  const onTrackClick = (e) => {
    if (e.target === thumbEl || thumbEl.contains(e.target)) return;
    if (opts.trackClick === 'none') return;
    
    const trackRect = trackEl.getBoundingClientRect();
    const pointer = axis === 'y' ? e.clientY : e.clientX;
    const trackStart = axis === 'y' ? trackRect.top : trackRect.left;
    const trackLength = axis === 'y' ? trackRect.height : trackRect.width;
    const thumbSize = callbacks.getThumbSize();
    const currentOffset = callbacks.getCurrentOffset();
    
    if (opts.trackClick === 'jump') {
      // Center thumb on click point
      const offset = Math.max(0, Math.min(
        pointer - trackStart - (thumbSize / 2),
        trackLength - thumbSize
      ));
      callbacks.onTrackClick(offset, trackLength);
    } else {
      // 'page': scroll by 0.9 * viewport
      const clickPos = pointer - trackStart;
      const thumbCenter = currentOffset + thumbSize / 2;
      const direction = clickPos > thumbCenter ? 1 : -1;
      callbacks.onPageClick(direction);
    }
  };
  
  // Hover events on track
  const onTrackEnter = () => callbacks.onTrackHoverEnter();
  const onTrackLeave = () => callbacks.onTrackHoverLeave();
  
  thumbEl.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  trackEl.addEventListener('click', onTrackClick);
  trackEl.addEventListener('pointerenter', onTrackEnter);
  trackEl.addEventListener('pointerleave', onTrackLeave);
  
  return {
    get dragging() { return dragging; },
    destroy() {
      thumbEl.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      trackEl.removeEventListener('click', onTrackClick);
      trackEl.removeEventListener('pointerenter', onTrackEnter);
      trackEl.removeEventListener('pointerleave', onTrackLeave);
    },
  };
}
