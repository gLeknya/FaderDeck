/**
 * Sets up DOM observers for a scrollbar instance.
 * - scroll (passive) on el
 * - ResizeObserver on el + direct children
 * - MutationObserver on el (childList only) to track children
 * - matchMedia for prefers-reduced-motion
 */

export function createObservers(el, callbacks) {
  // scroll listener
  const onScroll = () => callbacks.onScroll();
  el.addEventListener('scroll', onScroll, { passive: true });
  
  // ResizeObserver: el + direct children
  const resizeObserver = new ResizeObserver((entries) => {
    callbacks.onResize();
  });
  resizeObserver.observe(el);
  
  // Observe direct children
  const observeChildren = () => {
    for (const child of el.children) {
      resizeObserver.observe(child);
    }
  };
  observeChildren();
  
  // MutationObserver: childList to track new/removed children
  const mutationObserver = new MutationObserver((mutations) => {
    let childrenChanged = false;
    for (const mut of mutations) {
      if (mut.type === 'childList') {
        // Observe new children
        for (const node of mut.addedNodes) {
          if (node.nodeType === 1) { // Element
            resizeObserver.observe(node);
            childrenChanged = true;
          }
        }
        // Unobserve removed children
        for (const node of mut.removedNodes) {
          if (node.nodeType === 1) {
            resizeObserver.unobserve(node);
            childrenChanged = true;
          }
        }
      }
    }
    if (childrenChanged) callbacks.onResize();
  });
  mutationObserver.observe(el, { childList: true });
  
  // matchMedia for reduced motion
  let reducedMotion = false;
  let mediaQuery = null;
  
  if (typeof matchMedia !== 'undefined') {
    mediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mediaQuery.matches;
    const onMediaChange = (e) => {
      reducedMotion = e.matches;
      callbacks.onReducedMotionChange(reducedMotion);
    };
    mediaQuery.addEventListener('change', onMediaChange);
    // Store for cleanup
    mediaQuery._handler = onMediaChange;
  }
  
  return {
    get reducedMotion() { return reducedMotion; },
    destroy() {
      el.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (mediaQuery && mediaQuery._handler) {
        mediaQuery.removeEventListener('change', mediaQuery._handler);
      }
    },
  };
}
