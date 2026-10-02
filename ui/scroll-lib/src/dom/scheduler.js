/**
 * Global scheduler: one rAF loop for all scrollbar instances.
 * Read-then-write batching: first pass reads measurements, second writes CSS vars.
 */

const instances = new Set();
let rafId = null;
let lastTime = 0;

function tick(time) {
  const dt = lastTime ? time - lastTime : 16;
  lastTime = time;
  
  // Read pass: each instance measures DOM
  for (const inst of instances) {
    inst._read();
  }
  
  // Step pass: each instance runs engine
  let anyActive = false;
  for (const inst of instances) {
    if (inst._step(dt)) anyActive = true;
  }
  
  // Write pass: each instance writes CSS vars
  for (const inst of instances) {
    inst._write();
  }
  
  if (anyActive) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
    lastTime = 0;
  }
}

export function schedulerAdd(instance) {
  instances.add(instance);
  if (!rafId) {
    lastTime = 0;
    rafId = requestAnimationFrame(tick);
  }
}

export function schedulerRemove(instance) {
  instances.delete(instance);
  if (instances.size === 0 && rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
    lastTime = 0;
  }
}

export function schedulerWake() {
  if (!rafId && instances.size > 0) {
    lastTime = 0;
    rafId = requestAnimationFrame(tick);
  }
}

// For testing
export function schedulerReset() {
  instances.clear();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastTime = 0;
}
