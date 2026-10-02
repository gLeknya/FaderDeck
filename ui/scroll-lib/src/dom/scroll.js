import { computeGeometry, scrollFromOffset } from '../core/geometry.js';
import { createEngineState, engineStep } from '../core/engine.js';
import { createVisibility, visibilityEvent, visibilityTimeout, getVisibilityTarget, updateVisibilityConfig } from '../core/visibility.js';
import { decideWheel } from '../core/wheel.js';
import { mergeOptions } from '../core/options.js';
import { createStructure, updateStructureClasses } from './structure.js';
import { createObservers } from './observers.js';
import { createDrag } from './drag.js';
import { schedulerAdd, schedulerRemove, schedulerWake } from './scheduler.js';

// Instance registry (WeakMap: el -> instance)
const registry = new WeakMap();

export function getInstance(el) {
  return registry.get(el) || null;
}

export function createScroll(el, explicitOpts = {}, attrOpts = {}) {
  // Return existing instance
  if (registry.has(el)) return registry.get(el);
  
  let opts = mergeOptions(explicitOpts, attrOpts);
  
  // Create structure
  const structure = createStructure(el, opts);
  
  // Per-axis state
  const axes = {};
  const hasY = opts.axis === 'y' || opts.axis === 'both';
  const hasX = opts.axis === 'x' || opts.axis === 'both';
  
  // Smoothing params, respecting reduced motion
  let effectiveSmoothing = { ...opts.smoothing };
  let effectiveFadeIn = opts.fadeIn;
  let effectiveFadeOut = opts.fadeOut;
  
  function applyReducedMotion(reduced) {
    if (opts.reducedMotion === 'respect' && reduced) {
      effectiveSmoothing = { offset: 0, size: 0 };
      effectiveFadeIn = 0;
      effectiveFadeOut = 0;
    } else {
      effectiveSmoothing = { ...opts.smoothing };
      effectiveFadeIn = opts.fadeIn;
      effectiveFadeOut = opts.fadeOut;
    }
  }
  
  // Visibility machine (shared between axes for now)
  const visibility = createVisibility({
    mode: opts.visibility,
    triggers: opts.triggers,
    idleDelay: opts.idleDelay,
    hideWhenNoOverflow: opts.hideWhenNoOverflow,
  });
  
  let idleTimer = null;
  
  function handleVisibilityResult(result) {
    if (result.needsTimer) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const r = visibilityTimeout(visibility, Date.now());
        schedulerWake();
      }, result.timerDelay);
    }
    schedulerWake();
  }
  
  // Initialize axes
  for (const axis of (hasY ? ['y'] : []).concat(hasX ? ['x'] : [])) {
    axes[axis] = {
      engine: createEngineState({ easing: opts.easing }),
      geometry: { maxScroll: 0, scrollable: null, size: 0, offset: 0 },
      needsWrite: false,
    };
  }
  
  // Event emitter
  const listeners = {};
  function emit(event, data) {
    const fns = listeners[event];
    if (fns) fns.forEach(fn => fn(data));
  }
  
  // State
  let hostHovering = false;
  let trackHovering = false;
  let dragAxis = null;
  let destroyed = false;
  
  // Measure and compute geometry for one axis
  function measure(axis) {
    const isY = axis === 'y';
    const viewport = isY ? el.clientHeight : el.clientWidth;
    const content = isY ? el.scrollHeight : el.scrollWidth;
    const scroll = isY ? el.scrollTop : el.scrollLeft;
    const trackEl = structure.tracks[axis]?.el;
    if (!trackEl) return;
    
    const trackRect = trackEl.getBoundingClientRect();
    const track = isY ? trackRect.height : trackRect.width;
    
    if (track <= 0 || viewport <= 0) return; // hidden element
    
    const geo = computeGeometry({
      viewport, content, scroll, track,
      minThumb: opts.minThumb,
    });
    
    const prev = axes[axis].geometry;
    axes[axis].geometry = geo;
    
    // Update engine targets
    axes[axis].engine.offset.target = geo.offset;
    axes[axis].engine.size.target = geo.size;
    
    // Overflow change
    if (prev.scrollable !== geo.scrollable) {
      const result = visibilityEvent(visibility, 'overflowChange', { scrollable: geo.scrollable });
      handleVisibilityResult(result);
      emit('overflowchange', { axis, scrollable: geo.scrollable });
    }
  }
  
  // The instance object that the scheduler calls
  const schedulerInstance = {
    _read() {
      for (const axis of Object.keys(axes)) {
        measure(axis);
      }
    },
    
    _step(dt) {
      let anyActive = false;
      const presenceTarget = getVisibilityTarget(visibility);
      
      for (const [axis, state] of Object.entries(axes)) {
        const result = engineStep(
          state.engine,
          {
            offset: state.geometry.offset,
            size: state.geometry.size,
            presence: presenceTarget,
          },
          dt,
          {
            smoothOffset: effectiveSmoothing.offset,
            smoothSize: effectiveSmoothing.size,
            fadeIn: effectiveFadeIn,
            fadeOut: effectiveFadeOut,
            easing: opts.easing,
            dragging: dragAxis === axis,
          }
        );
        
        state.engine = result.state;
        state.needsWrite = result.changed.offset || result.changed.size || result.changed.presence;
        
        if (!result.settled) anyActive = true;
      }
      
      return anyActive;
    },
    
    _write() {
      for (const [axis, state] of Object.entries(axes)) {
        if (!state.needsWrite) continue;
        state.needsWrite = false;
        
        const trackEl = structure.tracks[axis]?.el;
        if (!trackEl) continue;
        
        trackEl.style.setProperty('--sb-thumb-offset', `${state.engine.offset.value}px`);
        trackEl.style.setProperty('--sb-thumb-size', `${state.engine.size.value}px`);
        trackEl.style.setProperty('--sb-presence', state.engine.presence.value.toFixed(3));
      }
      
      // Update structure classes
      updateStructureClasses(structure, {
        y: axes.y ? { scrollable: axes.y.geometry.scrollable, presence: axes.y.engine.presence.value } : undefined,
        x: axes.x ? { scrollable: axes.x.geometry.scrollable, presence: axes.x.engine.presence.value } : undefined,
        hoveringHost: hostHovering,
        hoveringTrack: trackHovering,
        dragging: !!dragAxis,
        active: getVisibilityTarget(visibility) === 1,
      });
    },
  };
  
  // Observers
  const observers = createObservers(el, {
    onScroll() {
      const result = visibilityEvent(visibility, 'scroll', { now: Date.now() });
      handleVisibilityResult(result);
      emit('scroll', null);
      schedulerWake();
    },
    onResize() {
      const result = visibilityEvent(visibility, 'resize', { now: Date.now() });
      handleVisibilityResult(result);
      emit('update', null);
      schedulerWake();
    },
    onReducedMotionChange(reduced) {
      applyReducedMotion(reduced);
      schedulerWake();
    },
  });
  
  applyReducedMotion(observers.reducedMotion);
  
  // Host hover
  const onHostEnter = () => {
    hostHovering = true;
    const result = visibilityEvent(visibility, 'hoverHostEnter', { now: Date.now() });
    handleVisibilityResult(result);
  };
  const onHostLeave = () => {
    hostHovering = false;
    const result = visibilityEvent(visibility, 'hoverHostLeave', { now: Date.now() });
    handleVisibilityResult(result);
  };
  structure.host.addEventListener('pointerenter', onHostEnter);
  structure.host.addEventListener('pointerleave', onHostLeave);
  
  // Drag handlers per axis
  const drags = {};
  for (const [axis, track] of Object.entries(structure.tracks)) {
    drags[axis] = createDrag(track.el, track.thumb, axis, {
      getThumbSize() {
        return axes[axis]?.engine.size.value || 0;
      },
      getCurrentOffset() {
        return axes[axis]?.engine.offset.value || 0;
      },
      onDragStart() {
        dragAxis = axis;
        el.style.scrollBehavior = 'auto';
        const result = visibilityEvent(visibility, 'dragStart', { now: Date.now() });
        handleVisibilityResult(result);
        emit('dragstart', { axis });
      },
      onDrag(offset, trackLength) {
        const geo = axes[axis].geometry;
        const scrollPos = scrollFromOffset({
          offset, track: trackLength, size: axes[axis].engine.size.value, maxScroll: geo.maxScroll
        });
        if (axis === 'y') el.scrollTop = scrollPos;
        else el.scrollLeft = scrollPos;
        // Direct offset for immediate feedback
        axes[axis].engine.offset.target = offset;
        axes[axis].engine.offset.value = offset; // bypass smoothing
        schedulerWake();
      },
      onDragEnd() {
        dragAxis = null;
        el.style.scrollBehavior = '';
        const result = visibilityEvent(visibility, 'dragEnd', { now: Date.now() });
        handleVisibilityResult(result);
        emit('dragend', { axis });
      },
      onTrackClick(offset, trackLength) {
        const geo = axes[axis].geometry;
        const scrollPos = scrollFromOffset({
          offset, track: trackLength, size: axes[axis].engine.size.value, maxScroll: geo.maxScroll
        });
        if (axis === 'y') el.scrollTop = scrollPos;
        else el.scrollLeft = scrollPos;
      },
      onPageClick(direction) {
        const viewport = axis === 'y' ? el.clientHeight : el.clientWidth;
        const amount = direction * viewport * 0.9;
        if (axis === 'y') el.scrollTop += amount;
        else el.scrollLeft += amount;
      },
      onTrackHoverEnter() {
        trackHovering = true;
        const result = visibilityEvent(visibility, 'hoverTrackEnter', { now: Date.now() });
        handleVisibilityResult(result);
      },
      onTrackHoverLeave() {
        trackHovering = false;
        const result = visibilityEvent(visibility, 'hoverTrackLeave', { now: Date.now() });
        handleVisibilityResult(result);
      },
    }, opts);
  }
  
  // Wheel handler
  let wheelHandler = null;
  if (opts.horizontalWheel !== 'shift' && hasX) {
    wheelHandler = (e) => {
      const geoY = axes.y?.geometry;
      const geoX = axes.x?.geometry;
      
      const result = decideWheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        horizontalWheel: opts.horizontalWheel,
        hasX,
        hasY,
        scrollLeft: el.scrollLeft,
        maxScrollX: geoX?.maxScroll || 0,
        scrollTop: el.scrollTop,
        maxScrollY: geoY?.maxScroll || 0,
        viewportWidth: el.clientWidth,
        viewportHeight: el.clientHeight,
      });
      
      if (result.handled) {
        e.preventDefault();
        el.scrollLeft += result.dx;
      }
    };
    el.addEventListener('wheel', wheelHandler, { passive: false });
  }
  
  // Register with scheduler
  schedulerAdd(schedulerInstance);
  
  // Public instance
  const instance = {
    el,
    
    update() {
      schedulerWake();
    },
    
    setOptions(newOpts) {
      opts = mergeOptions({ ...explicitOpts, ...newOpts });
      // Update visibility config
      updateVisibilityConfig(visibility, {
        mode: opts.visibility,
        triggers: opts.triggers,
        idleDelay: opts.idleDelay,
        hideWhenNoOverflow: opts.hideWhenNoOverflow,
      });
      applyReducedMotion(observers.reducedMotion);
      schedulerWake();
    },
    
    on(event, fn) {
      if (!listeners[event]) listeners[event] = new Set();
      listeners[event].add(fn);
    },
    
    off(event, fn) {
      listeners[event]?.delete(fn);
    },
    
    getState() {
      const state = {};
      for (const [axis, s] of Object.entries(axes)) {
        state[axis] = {
          offset: s.engine.offset.value,
          size: s.engine.size.value,
          presence: s.engine.presence.value,
          scrollable: s.geometry.scrollable,
          maxScroll: s.geometry.maxScroll,
        };
      }
      return state;
    },
    
    destroy() {
      if (destroyed) return;
      destroyed = true;
      
      // Remove from registry
      registry.delete(el);
      
      // Remove from scheduler
      schedulerRemove(schedulerInstance);
      
      // Clear idle timer
      clearTimeout(idleTimer);
      
      // Destroy drag handlers
      for (const drag of Object.values(drags)) {
        drag.destroy();
      }
      
      // Remove wheel handler
      if (wheelHandler) {
        el.removeEventListener('wheel', wheelHandler);
      }
      
      // Remove host hover listeners
      structure.host.removeEventListener('pointerenter', onHostEnter);
      structure.host.removeEventListener('pointerleave', onHostLeave);
      
      // Destroy observers
      observers.destroy();
      
      // Destroy structure (removes tracks, restores DOM)
      structure.destroy();
      
      emit('destroy', null);
    },
  };
  
  // Register
  registry.set(el, instance);
  
  return instance;
}
