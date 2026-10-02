const DEFAULTS = {
  axis: 'y',
  mount: null,
  visibility: 'auto',
  triggers: { scroll: true, hoverHost: true, hoverTrack: true, drag: true, resize: true },
  idleDelay: 900,
  fadeIn: 120,
  fadeOut: 350,
  easing: 'ease-out',
  hideWhenNoOverflow: true,
  smoothing: { offset: 80, size: 140 },
  minThumb: 24,
  horizontalWheel: 'shift',
  trackClick: 'page',
  animation: 'fade',
  reducedMotion: 'respect',
  preset: null,
  className: '',
};

const VALID_VALUES = {
  axis: ['y', 'x', 'both'],
  visibility: ['auto', 'always', 'hover', 'never'],
  horizontalWheel: ['shift', 'always', 'auto'],
  trackClick: ['page', 'jump', 'none'],
  animation: ['fade', 'slide', 'scale', 'none'],
  reducedMotion: ['respect', 'ignore'],
};

let userDefaults = {};
const presets = new Map();

export function getDefaults() { return { ...DEFAULTS }; }

export function setDefaults(opts) {
  userDefaults = { ...userDefaults, ...opts };
}

export function resetDefaults() {
  userDefaults = {};
}

export function definePreset(name, preset) {
  // preset: { options?: {}, className?: '' }
  presets.set(name, preset);
}

export function getPreset(name) {
  return presets.get(name) || null;
}

/**
 * Merge options with priority: DEFAULTS < userDefaults < preset < attrOpts < explicitOpts
 * @param {object} [explicitOpts]
 * @param {object} [attrOpts] - from data-scroll-* parsing
 * @returns {object} merged and validated options
 */
export function mergeOptions(explicitOpts = {}, attrOpts = {}) {
  // Resolve preset
  const presetName = explicitOpts.preset || attrOpts.preset || userDefaults.preset || null;
  const preset = presetName ? (presets.get(presetName) || {}) : {};
  const presetOpts = preset.options || {};
  const presetClassName = preset.className || '';
  
  // Deep merge for triggers and smoothing
  const merged = {
    ...DEFAULTS,
    ...userDefaults,
    ...presetOpts,
    ...attrOpts,
    ...explicitOpts,
  };
  
  // Merge triggers deeply
  merged.triggers = {
    ...DEFAULTS.triggers,
    ...(userDefaults.triggers || {}),
    ...(presetOpts.triggers || {}),
    ...(attrOpts.triggers || {}),
    ...(explicitOpts.triggers || {}),
  };
  
  // Normalize smoothing
  if (typeof merged.smoothing === 'number') {
    merged.smoothing = { offset: merged.smoothing, size: merged.smoothing };
  } else {
    merged.smoothing = {
      ...DEFAULTS.smoothing,
      ...(typeof userDefaults.smoothing === 'object' ? userDefaults.smoothing : {}),
      ...(typeof presetOpts.smoothing === 'object' ? presetOpts.smoothing : {}),
      ...(typeof attrOpts.smoothing === 'object' ? attrOpts.smoothing : {}),
      ...(typeof explicitOpts.smoothing === 'object' ? explicitOpts.smoothing : {}),
    };
  }
  
  // Apply preset className
  if (presetClassName && !merged.className) {
    merged.className = presetClassName;
  }
  
  // Validate
  for (const [key, validValues] of Object.entries(VALID_VALUES)) {
    if (merged[key] !== undefined && !validValues.includes(merged[key])) {
      console.warn(`[fader-scroll] Invalid value '${merged[key]}' for option '${key}'. Valid: ${validValues.join(', ')}. Using default '${DEFAULTS[key]}'.`);
      merged[key] = DEFAULTS[key];
    }
  }
  
  return merged;
}

export function clearPresets() {
  presets.clear();
}
