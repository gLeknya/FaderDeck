/**
 * Unified entry point for fader-scroll across FaderDeck.
 *
 * Configures global defaults and presets, ensures library and theme CSS are attached,
 * and re-exports createScroll, initScrolls, and getInstance for ES modules and window.faderScroll.
 */

import {
  createScroll as coreCreateScroll,
  initScrolls as coreInitScrolls,
  getInstance as coreGetInstance,
  setDefaults,
  definePreset
} from '../scroll-lib/src/index.js';

// 1. Configure global application defaults
setDefaults({
  visibility: 'auto',
  idleDelay: 900,
  fadeIn: 120,
  fadeOut: 350,
  smoothing: { offset: 80, size: 140 },
  minThumb: 24,
  horizontalWheel: 'shift',
  hideWhenNoOverflow: true,
  trackClick: 'page',
  animation: 'fade',
  reducedMotion: 'respect',
});

// 2. Define application-wide presets
definePreset('thin', {
  options: { minThumb: 20 },
  className: 'sb-theme-thin'
});

/**
 * Ensures fader-scroll base stylesheet and FaderDeck theme are injected into the current document.
 */
export function ensureStylesLoaded() {
  if (typeof document === 'undefined') return;

  if (!document.querySelector('link[data-fader-scroll-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../scroll-lib/styles/fader-scroll.css', import.meta.url).href;
    link.setAttribute('data-fader-scroll-css', '');
    document.head.appendChild(link);
  }

  if (!document.querySelector('link[data-fader-scroll-theme-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../fader-scroll-theme.css', import.meta.url).href;
    link.setAttribute('data-fader-scroll-theme-css', '');
    document.head.appendChild(link);
  }
}

/**
 * Re-exported createScroll wrapping core implementation with style assurance.
 */
export function createScroll(el, opts = {}) {
  ensureStylesLoaded();
  return coreCreateScroll(el, opts);
}

/**
 * Re-exported initScrolls finding all [data-scroll] within root.
 */
export function initScrolls(root = document) {
  ensureStylesLoaded();
  return coreInitScrolls(root);
}

/**
 * Re-exported getInstance returning active scroll instance for element.
 */
export function getInstance(el) {
  return coreGetInstance(el);
}

// Attach to window for classic non-module scripts (e.g. app.js, entity-editor.js, dropdowns.js)
if (typeof window !== 'undefined') {
  window.faderScroll = {
    createScroll,
    initScrolls,
    getInstance,
    setDefaults,
    definePreset,
    ensureStylesLoaded
  };
}

/**
 * Auto-initialize declarative [data-scroll] elements on DOM load.
 */
export function initFaderScroll() {
  ensureStylesLoaded();
  if (typeof document !== 'undefined') {
    initScrolls(document);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initFaderScroll();
    });
  } else {
    initFaderScroll();
  }
}

export { setDefaults, definePreset };
