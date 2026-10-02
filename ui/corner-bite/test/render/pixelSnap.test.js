import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { snapValue, snapGeometry, createSnapManager } from '../../src/render/pixelSnap.js';

describe('pixelSnap', () => {
  test('snapValue rounds to 1/DPR', () => {
    // DPR = 1: integer rounding
    assert.equal(snapValue(10.4, 1), 10);
    assert.equal(snapValue(10.6, 1), 11);

    // DPR = 2: 0.5 step rounding
    assert.equal(snapValue(10.2, 2), 10);
    assert.equal(snapValue(10.3, 2), 10.5);
    assert.equal(snapValue(10.74, 2), 10.5);
    assert.equal(snapValue(10.8, 2), 11);

    // DPR = 3: 0.333... step rounding
    assert.ok(Math.abs(snapValue(10.3, 3) - 10.333333) < 0.01);
  });

  test('snapGeometry snaps all rect dimensions and coordinates', () => {
    const geo = [
      { x: 10.23, y: 20.67, w: 30.12, h: 40.89, r: 5.4 }
    ];
    const snapped = snapGeometry(geo, 2);

    assert.deepEqual(snapped, [
      { x: 10, y: 20.5, w: 30, h: 41, r: 5.5 }
    ]);
  });

  test('createSnapManager executes snapped render after debounce', async () => {
    let snappedRenders = [];
    const manager = createSnapManager({
      getGeometry: () => [{ x: 10.3, y: 20.7, w: 30.2, h: 40.8 }],
      onSnapRender: (geo) => {
        snappedRenders.push(geo);
      },
      debounceMs: 20
    });

    // Notify updates rapidly
    manager.notifyChange();
    manager.notifyChange();
    manager.notifyChange();

    assert.equal(snappedRenders.length, 0, 'should not snap immediately during updates');

    // Wait for debounce timer to fire
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(snappedRenders.length, 1, 'should have executed snapped render once idle');
    manager.destroy();
  });
});
