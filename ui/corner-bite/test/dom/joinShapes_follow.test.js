import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { joinShapes } from '../../src/index.js';

describe('joinShapes follow: true and WAAPI getAnimations termination', () => {
  test('stops follow RAF loop when getAnimations reports no running animations, even if transitionend never arrived', () => {
    let rafCallbacks = [];
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = (id) => {
      rafCallbacks = [];
    };

    const doc = {
      createElementNS: () => ({
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        removeChild: () => {}
      })
    };

    const container = {
      nodeType: 1,
      tagName: 'div',
      ownerDocument: doc,
      children: [],
      style: { position: 'relative' },
      parentElement: null,
      scrollLeft: 0,
      scrollTop: 0,
      clientLeft: 0,
      clientTop: 0,
      appendChild(c) { c.parentNode = container; return c; },
      removeChild(c) { return c; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400 })
    };

    const listeners1 = {};
    let animations1 = [{ playState: 'running' }];

    const el1 = {
      nodeType: 1,
      tagName: 'div',
      ownerDocument: doc,
      parentNode: container,
      parentElement: container,
      children: [],
      style: {},
      addEventListener(evt, fn) { listeners1[evt] = listeners1[evt] || []; listeners1[evt].push(fn); },
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 50, height: 50, right: 60, bottom: 60 }),
      getAnimations: () => animations1
    };

    const el2 = {
      nodeType: 1,
      tagName: 'div',
      ownerDocument: doc,
      parentNode: container,
      parentElement: container,
      children: [],
      style: {},
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 50, top: 10, width: 50, height: 50, right: 100, bottom: 60 }),
      getAnimations: () => []
    };

    container.children = [el1, el2];

    try {
      const controller = joinShapes([el1, el2], {
        follow: true,
        mode: 'svg'
      });

      // Simulate transitionstart
      listeners1['transitionstart']?.[0]?.();

      assert.ok(rafCallbacks.length > 0, 'Follow loop should have started RAF');

      // Now simulation: animation finishes or was aborted, so getAnimations returns empty
      // BUT transitionend NEVER arrived (e.g. cancelled without event)
      animations1 = []; // no running animations

      // Run one frame tick
      const frame = rafCallbacks.shift();
      frame?.();

      // Check: the loop should have detected no running animations and NOT requested another RAF frame!
      assert.strictEqual(rafCallbacks.length, 0, 'Loop should terminate when getAnimations() has no running animations');

      controller.destroy();
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
    }
  });
});
