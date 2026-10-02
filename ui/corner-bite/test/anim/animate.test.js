import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateGeometry, animate } from '../../src/anim/animate.js';

describe('animate', () => {
  test('interpolateGeometry accurately calculates boundaries and midpoint', () => {
    const from = [
      { x: 0, y: 0, w: 100, h: 50, r: 10 }
    ];
    const to = [
      { x: 100, y: 200, w: 200, h: 100, r: 20 }
    ];

    // t = 0
    const at0 = interpolateGeometry(from, to, 0);
    assert.deepEqual(at0, from);

    // t = 1
    const at1 = interpolateGeometry(from, to, 1);
    assert.deepEqual(at1, to);

    // t = 0.5 (midpoint)
    const mid = interpolateGeometry(from, to, 0.5);
    assert.deepEqual(mid, [
      { x: 50, y: 100, w: 150, h: 75, r: 15 }
    ]);
  });

  test('throws descriptive error on geometry structure mismatch', () => {
    const mockShape = {
      geometry: [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 100, y: 0, w: 100, h: 100 }
      ],
      update() {}
    };

    // Attempting to animate to 3 rectangles
    assert.throws(
      () => animate(mockShape, [
        { x: 0, y: 0, w: 50, h: 50 },
        { x: 50, y: 0, w: 50, h: 50 },
        { x: 100, y: 0, w: 50, h: 50 }
      ]),
      /Cannot animate between geometries with different structure \(expected 2, got 3\)/
    );
  });

  test('animates shape and resolves finished promise with final geometry', async () => {
    const updates = [];
    const mockShape = {
      geometry: [{ x: 0, y: 0, w: 100, h: 100 }],
      update(geo) {
        this.geometry = geo;
        updates.push(geo);
      }
    };

    const targetGeo = [{ x: 50, y: 50, w: 150, h: 150 }];
    const anim = animate(mockShape, targetGeo, {
      duration: 30,
      easing: 'linear'
    });

    const result = await anim.finished;
    assert.deepEqual(result, targetGeo);
    assert.ok(updates.length >= 2, 'should have multiple frames');
    // Final update should match target
    assert.deepEqual(updates[updates.length - 1], targetGeo);
  });

  test('new animate on the same shape cancels previous animation', async () => {
    let cancelCalled = false;
    const mockShape = {
      geometry: [{ x: 0, y: 0, w: 100, h: 100 }],
      update(geo) {
        this.geometry = geo;
      }
    };

    const anim1 = animate(mockShape, [{ x: 100, y: 100, w: 100, h: 100 }], { duration: 200 });
    anim1.finished.catch((err) => {
      if (err.message === 'Animation cancelled') {
        cancelCalled = true;
      }
    });

    // Start second animation immediately
    const anim2 = animate(mockShape, [{ x: 200, y: 200, w: 100, h: 100 }], { duration: 20 });
    await anim2.finished;

    assert.equal(cancelCalled, true, 'previous animation should have been cancelled');
  });
});
