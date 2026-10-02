export function createVisibility(opts) {
  const config = {
    mode: opts.mode || 'auto',
    triggers: { scroll: true, hoverHost: true, hoverTrack: true, drag: true, resize: true, ...opts.triggers },
    idleDelay: opts.idleDelay ?? 900,
    hideWhenNoOverflow: opts.hideWhenNoOverflow ?? true,
    clock: opts.clock || Date.now,
  };
  
  const state = {
    target: config.mode === 'always' ? 1 : 0,
    scrollable: true,
    hoveringHost: false,
    hoveringTrack: false,
    dragging: false,
    lastActivityTime: -Infinity,
    lastHoverEndTime: -Infinity,
    idleTimerId: null,
  };
  
  return { config, state };
}

function computeTargetAndTimer(config, state, now) {
  if (!state.scrollable && config.hideWhenNoOverflow) {
    return { target: 0, needsTimer: false, timerDelay: 0 };
  }

  if (config.mode === 'never') {
    return { target: 0, needsTimer: false, timerDelay: 0 };
  }

  if (config.mode === 'always') {
    return { target: 1, needsTimer: false, timerDelay: 0 };
  }

  const isHoverOrDrag = 
    (config.triggers.hoverHost && state.hoveringHost) ||
    (config.triggers.hoverTrack && state.hoveringTrack) ||
    (config.triggers.drag && state.dragging);

  if (isHoverOrDrag) {
    return { target: 1, needsTimer: false, timerDelay: 0 };
  }

  if (config.mode === 'hover') {
    const elapsed = now - state.lastHoverEndTime;
    if (elapsed < config.idleDelay) {
      return { target: 1, needsTimer: true, timerDelay: config.idleDelay - elapsed };
    }
    return { target: 0, needsTimer: false, timerDelay: 0 };
  }

  // auto mode
  const elapsed = now - state.lastActivityTime;
  if (elapsed < config.idleDelay) {
    return { target: 1, needsTimer: true, timerDelay: config.idleDelay - elapsed };
  }

  return { target: 0, needsTimer: false, timerDelay: 0 };
}

export function visibilityEvent(machine, event, data = {}) {
  const { config, state } = machine;
  const now = data.now ?? config.clock();

  const wasHoverOrDrag = 
    (config.triggers.hoverHost && state.hoveringHost) ||
    (config.triggers.hoverTrack && state.hoveringTrack) ||
    (config.triggers.drag && state.dragging);

  switch (event) {
    case 'overflowChange':
      if (data.scrollable !== undefined) state.scrollable = data.scrollable;
      break;
    case 'scroll':
      if (config.triggers.scroll) state.lastActivityTime = now;
      break;
    case 'resize':
      if (config.triggers.resize) state.lastActivityTime = now;
      break;
    case 'hoverHostEnter':
      state.hoveringHost = true;
      if (config.triggers.hoverHost) state.lastActivityTime = now;
      break;
    case 'hoverHostLeave':
      state.hoveringHost = false;
      if (config.triggers.hoverHost) state.lastActivityTime = now;
      break;
    case 'hoverTrackEnter':
      state.hoveringTrack = true;
      if (config.triggers.hoverTrack) state.lastActivityTime = now;
      break;
    case 'hoverTrackLeave':
      state.hoveringTrack = false;
      if (config.triggers.hoverTrack) state.lastActivityTime = now;
      break;
    case 'dragStart':
      state.dragging = true;
      if (config.triggers.drag) state.lastActivityTime = now;
      break;
    case 'dragEnd':
      state.dragging = false;
      if (config.triggers.drag) state.lastActivityTime = now;
      break;
  }

  const isHoverOrDrag = 
    (config.triggers.hoverHost && state.hoveringHost) ||
    (config.triggers.hoverTrack && state.hoveringTrack) ||
    (config.triggers.drag && state.dragging);

  if (wasHoverOrDrag && !isHoverOrDrag) {
    state.lastHoverEndTime = now;
  }

  const result = computeTargetAndTimer(config, state, now);
  state.target = result.target;
  return result;
}

export function visibilityTimeout(machine, now) {
  const { config, state } = machine;
  const t = now ?? config.clock();
  const result = computeTargetAndTimer(config, state, t);
  state.target = result.target;
  return { target: result.target };
}

export function getVisibilityTarget(machine) {
  return machine.state.target;
}

export function updateVisibilityConfig(machine, opts) {
  const { config, state } = machine;
  const now = config.clock();

  const wasHoverOrDrag = 
    (config.triggers.hoverHost && state.hoveringHost) ||
    (config.triggers.hoverTrack && state.hoveringTrack) ||
    (config.triggers.drag && state.dragging);

  if (opts.mode !== undefined) config.mode = opts.mode;
  if (opts.triggers !== undefined) config.triggers = { ...config.triggers, ...opts.triggers };
  if (opts.idleDelay !== undefined) config.idleDelay = opts.idleDelay;
  if (opts.hideWhenNoOverflow !== undefined) config.hideWhenNoOverflow = opts.hideWhenNoOverflow;
  if (opts.clock !== undefined) config.clock = opts.clock;

  const isHoverOrDrag = 
    (config.triggers.hoverHost && state.hoveringHost) ||
    (config.triggers.hoverTrack && state.hoveringTrack) ||
    (config.triggers.drag && state.dragging);

  if (wasHoverOrDrag && !isHoverOrDrag) {
    state.lastHoverEndTime = now;
    state.lastActivityTime = now;
  }

  const result = computeTargetAndTimer(config, state, now);
  state.target = result.target;
  return result;
}
