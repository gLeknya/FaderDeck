/**
 * Creates and manages the DOM structure for a scrollbar instance.
 * - Wraps el in host (if parent isn't already .sb-host)
 * - Creates track + thumb elements
 * - Hides native scrollbar via inline styles + class
 * - Provides teardown to restore original DOM
 */

export function createStructure(el, opts) {
  let host;
  let createdHost = false;
  
  // Check if parent is already a host
  if (el.parentElement && el.parentElement.classList.contains('sb-host')) {
    host = el.parentElement;
  } else {
    // Create host wrapper
    host = document.createElement('div');
    createdHost = true;
    el.parentNode.insertBefore(host, el);
    host.appendChild(el);
  }
  
  // Add classes
  host.classList.add('sb-host');
  el.classList.add('sb-viewport');
  
  const hasY = opts.axis === 'y' || opts.axis === 'both';
  const hasX = opts.axis === 'x' || opts.axis === 'both';
  
  if (hasY) host.classList.add('sb-has-y');
  if (hasX) host.classList.add('sb-has-x');
  if (hasY && hasX) host.classList.add('sb-has-both');
  
  // Animation class
  if (opts.animation && opts.animation !== 'none') {
    host.classList.add(`sb-anim-${opts.animation}`);
  }
  
  // Theme class
  if (opts.className) {
    host.classList.add(...opts.className.split(/\s+/).filter(Boolean));
  }
  
  // Hide native scrollbar
  el.style.scrollbarWidth = 'none';
  el.style.msOverflowStyle = 'none';
  
  // Create tracks
  const tracks = {};
  
  if (hasY) {
    tracks.y = createTrack('y', opts);
  }
  if (hasX) {
    tracks.x = createTrack('x', opts);
  }
  
  // Mount tracks
  for (const [axis, track] of Object.entries(tracks)) {
    const mountTarget = resolveMountTarget(opts.mount, axis);
    if (mountTarget) {
      mountTarget.appendChild(track.el);
    } else {
      host.appendChild(track.el);
    }
  }
  
  return {
    host,
    el,
    tracks,
    createdHost,
    destroy() {
      // Remove tracks
      for (const track of Object.values(tracks)) {
        track.el.remove();
      }
      
      // Remove classes from host
      host.classList.remove('sb-host', 'sb-has-y', 'sb-has-x', 'sb-has-both',
        'sb-active', 'sb-hover', 'sb-dragging',
        'sb-anim-fade', 'sb-anim-slide', 'sb-anim-scale');
      if (opts.className) {
        host.classList.remove(...opts.className.split(/\s+/).filter(Boolean));
      }
      
      // Remove viewport class and styles
      el.classList.remove('sb-viewport');
      el.style.scrollbarWidth = '';
      el.style.msOverflowStyle = '';
      
      // Unwrap host if we created it
      if (createdHost && host.parentNode) {
        host.parentNode.insertBefore(el, host);
        host.remove();
      }
    },
  };
}

function createTrack(axis, opts) {
  const track = document.createElement('div');
  track.classList.add('sb-track', `sb-${axis}`);
  track.setAttribute('aria-hidden', 'true');
  
  // Start hidden
  track.classList.add('sb-hidden');
  track.style.setProperty('--sb-thumb-offset', '0px');
  track.style.setProperty('--sb-thumb-size', '0px');
  track.style.setProperty('--sb-presence', '0');
  
  const thumb = document.createElement('div');
  thumb.classList.add('sb-thumb');
  track.appendChild(thumb);
  
  return { el: track, thumb };
}

function resolveMountTarget(mount, axis) {
  if (!mount) return null;
  if (typeof mount === 'string') {
    return document.querySelector(mount);
  }
  if (typeof mount === 'object') {
    const selector = mount[axis];
    if (selector) return document.querySelector(selector);
  }
  if (mount instanceof Element) return mount;
  return null;
}

export function updateStructureClasses(structure, state) {
  const { host, tracks } = structure;
  
  host.classList.toggle('sb-scrollable-y', !!state.y?.scrollable);
  host.classList.toggle('sb-scrollable-x', !!state.x?.scrollable);
  host.classList.toggle('sb-hover', !!state.hoveringHost);
  host.classList.toggle('sb-dragging', !!state.dragging);
  host.classList.toggle('sb-active', !!state.active);
  
  for (const [axis, track] of Object.entries(tracks)) {
    const axisState = state[axis];
    if (!axisState) continue;
    
    const presence = axisState.presence;
    track.el.classList.toggle('sb-visible', presence > 0);
    track.el.classList.toggle('sb-hidden', presence === 0);
    track.el.classList.toggle('sb-hover', !!state.hoveringTrack);
    track.el.classList.toggle('sb-dragging', !!state.dragging);
  }
}
