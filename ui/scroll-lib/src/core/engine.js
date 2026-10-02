/**
 * Exponential smoothing step, frame-rate independent.
 * @param {number} current - current value
 * @param {number} target - target value
 * @param {number} dt - delta time in ms
 * @param {number} tau - time constant in ms (0 = instant)
 * @returns {{ value: number, settled: boolean }}
 */
export function smoothStep(current, target, dt, tau) {
  if (tau <= 0 || dt <= 0) return { value: target, settled: true };
  const alpha = 1 - Math.exp(-dt / tau);
  const value = current + (target - current) * alpha;
  // Snap to target if close enough (0.1px threshold)
  if (Math.abs(target - value) < 0.1) {
    return { value: target, settled: true };
  }
  return { value, settled: false };
}

// Built-in easings
const EASINGS = {
  'linear': t => t,
  'ease-out': t => 1 - (1 - t) ** 2,
  'ease-in': t => t * t,
  'ease-in-out': t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
};

export function resolveEasing(easing) {
  if (typeof easing === 'function') return easing;
  return EASINGS[easing] || EASINGS['ease-out'];
}

/**
 * Presence tween state.
 * @typedef {{ value: number, target: number, startValue: number, elapsed: number, duration: number, easing: function }} TweenState
 */

/**
 * Create initial tween state.
 */
export function createTweenState(initialValue = 0, easing = 'ease-out') {
  return {
    value: initialValue,
    target: initialValue,
    startValue: initialValue,
    elapsed: 0,
    duration: 0,
    easing: resolveEasing(easing),
  };
}

/**
 * Set a new target for the tween. Handles mid-animation reversal.
 * @param {TweenState} state
 * @param {number} target - 0 or 1
 * @param {number} duration - in ms (fadeIn or fadeOut)
 * @param {string|function} easing
 * @returns {TweenState} new state
 */
export function tweenSetTarget(state, target, duration, easing) {
  if (target === state.target) return state;
  return {
    value: state.value,
    target,
    startValue: state.value, // continues from current value (mid-animation reversal)
    elapsed: 0,
    duration: duration,
    easing: resolveEasing(easing),
  };
}

/**
 * Step the tween forward by dt ms.
 * @param {TweenState} state
 * @param {number} dt - delta time in ms
 * @returns {{ state: TweenState, settled: boolean }}
 */
export function tweenStep(state, dt) {
  if (state.value === state.target) {
    return { state, settled: true };
  }
  
  if (state.duration <= 0) {
    const newState = { ...state, value: state.target, elapsed: 0 };
    return { state: newState, settled: true };
  }
  
  const elapsed = state.elapsed + dt;
  const t = Math.min(elapsed / state.duration, 1);
  const eased = state.easing(t);
  const value = state.startValue + (state.target - state.startValue) * eased;
  
  const settled = t >= 1;
  return {
    state: {
      ...state,
      value: settled ? state.target : value,
      elapsed,
    },
    settled,
  };
}

export function createEngineState(opts = {}) {
  return {
    offset: { value: 0, target: 0 },
    size: { value: 0, target: 0 },
    presence: createTweenState(0, opts.easing || 'ease-out'),
  };
}

/**
 * One frame step for the full engine.
 * @param {object} state - engine state
 * @param {object} targets - { offset, size, presence }
 * @param {number} dt - delta time in ms
 * @param {object} params - { smoothOffset, smoothSize, fadeIn, fadeOut, easing, dragging }
 * @returns {{ state: object, settled: boolean, changed: { offset: boolean, size: boolean, presence: boolean } }}
 */
export function engineStep(state, targets, dt, params) {
  // offset smoothing (bypass if dragging)
  const offsetTau = params.dragging ? 0 : params.smoothOffset;
  const offsetResult = smoothStep(state.offset.value, targets.offset, dt, offsetTau);
  
  // size smoothing
  const sizeResult = smoothStep(state.size.value, targets.size, dt, params.smoothSize);
  
  // presence tween
  const presenceDuration = targets.presence > state.presence.target
    ? params.fadeIn
    : params.fadeOut;
  let presenceState = tweenSetTarget(state.presence, targets.presence, presenceDuration, params.easing);
  const presenceResult = tweenStep(presenceState, dt);
  
  const newState = {
    offset: { value: offsetResult.value, target: targets.offset },
    size: { value: sizeResult.value, target: targets.size },
    presence: presenceResult.state,
  };
  
  const EPSILON = 0.01;
  return {
    state: newState,
    settled: offsetResult.settled && sizeResult.settled && presenceResult.settled,
    changed: {
      offset: Math.abs(newState.offset.value - state.offset.value) > EPSILON,
      size: Math.abs(newState.size.value - state.size.value) > EPSILON,
      presence: Math.abs(newState.presence.value - state.presence.value) > 0.001,
    },
  };
}
