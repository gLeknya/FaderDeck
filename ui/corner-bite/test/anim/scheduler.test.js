import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, areGeometriesEqual } from '../../src/anim/scheduler.js';

describe('Scheduler', () => {
  test('areGeometriesEqual compares rects and vertices within tolerance', () => {
    const a = [{ x: 10, y: 20, w: 30, h: 40 }];
    const b = [{ x: 10.0001, y: 19.9999, w: 30, h: 40 }];
    const c = [{ x: 10.1, y: 20, w: 30, h: 40 }];

    assert.equal(areGeometriesEqual(a, b, 1e-3), true);
    assert.equal(areGeometriesEqual(a, c, 1e-3), false);
    assert.equal(areGeometriesEqual(a, []), false);
  });

  test('deduplicates multiple updates in one frame with injectable RAF', () => {
    let queuedCallback = null;
    const mockRaf = (cb) => {
      queuedCallback = cb;
      return 1;
    };
    const mockCancelRaf = () => {
      queuedCallback = null;
    };

    const scheduler = createScheduler({ raf: mockRaf, cancelRaf: mockCancelRaf });

    let renderCalls = 0;
    const render = () => { renderCalls++; };

    // Schedule 5 times within the same frame
    scheduler.schedule('shape1', render, [{ x: 0, y: 0, w: 10, h: 10 }]);
    scheduler.schedule('shape1', render, [{ x: 0, y: 0, w: 20, h: 20 }]);
    scheduler.schedule('shape1', render, [{ x: 0, y: 0, w: 30, h: 30 }]);
    scheduler.schedule('shape1', render, [{ x: 0, y: 0, w: 40, h: 40 }]);
    scheduler.schedule('shape1', render, [{ x: 0, y: 0, w: 50, h: 50 }]);

    assert.equal(renderCalls, 0, 'should not execute synchronously');
    assert.ok(queuedCallback !== null, 'should have scheduled 1 RAF');

    // Trigger RAF frame
    queuedCallback();

    // Must have executed EXACTLY ONCE
    assert.equal(renderCalls, 1, 'should execute render only once per frame');
  });

  test('skips recalculation if geometry is unchanged within tolerance', () => {
    let queuedCallback = null;
    const mockRaf = (cb) => {
      queuedCallback = cb;
      return 1;
    };

    const scheduler = createScheduler({ raf: mockRaf, cancelRaf: () => {} });

    let renderCalls = 0;
    const render = () => { renderCalls++; };

    // First frame
    scheduler.schedule('shape1', render, [{ x: 10, y: 10, w: 10, h: 10 }]);
    queuedCallback();
    assert.equal(renderCalls, 1);

    // Second frame with identical geometry
    scheduler.schedule('shape1', render, [{ x: 10.0001, y: 10, w: 10, h: 10 }]);
    queuedCallback();
    // Render should have been skipped!
    assert.equal(renderCalls, 1, 'unchanged geometry should be skipped');

    // Third frame with changed geometry
    scheduler.schedule('shape1', render, [{ x: 20, y: 10, w: 10, h: 10 }]);
    queuedCallback();
    assert.equal(renderCalls, 2, 'changed geometry should be rendered');
  });

  test('skips recalculation for hidden elements', () => {
    let queuedCallback = null;
    const mockRaf = (cb) => {
      queuedCallback = cb;
      return 1;
    };

    const scheduler = createScheduler({ raf: mockRaf, cancelRaf: () => {} });

    let renderCalls = 0;
    const render = () => { renderCalls++; };

    const hiddenElement = {
      isConnected: true,
      getClientRects() { return []; } // Hidden (display: none or zero size)
    };

    scheduler.schedule('shape1', render, [{ x: 0, y: 0, w: 10, h: 10 }], hiddenElement);
    queuedCallback();

    assert.equal(renderCalls, 0, 'hidden element should be skipped');
  });
});
