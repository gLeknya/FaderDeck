import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unionRects, roundedUnion } from '../../src/index.js';

describe('unionRects', () => {
  test('single rectangle returns 4 vertices', () => {
    const contours = unionRects([{ x: 10, y: 20, w: 30, h: 40 }]);
    assert.equal(contours.length, 1);
    assert.equal(contours[0].length, 4);
    assert.deepEqual(contours[0], [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 }
    ]);
  });

  test('two overlapping rectangles merge into single staircase contour with collinear removed', () => {
    // Rect 1: [0, 0, 10, 10], Rect 2: [5, 5, 10, 10]
    const contours = unionRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 5, y: 5, w: 10, h: 10 }
    ]);

    assert.equal(contours.length, 1);
    // 8 vertices: (0,0) -> (10,0) -> (10,5) -> (15,5) -> (15,15) -> (5,15) -> (5,10) -> (0,10)
    assert.equal(contours[0].length, 8);
  });

  test('two touching rectangles merge into one clean rectangle', () => {
    // Rect 1: [0, 0, 10, 10], Rect 2: [10, 0, 10, 10] touching along x = 10
    const contours = unionRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 }
    ]);

    assert.equal(contours.length, 1);
    // Boundary should be [0, 0, 20, 10], exactly 4 vertices with no collinear points at x=10
    assert.equal(contours[0].length, 4);
    assert.deepEqual(contours[0], [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 }
    ]);
  });

  test('disjoint rectangles produce multiple separate contours', () => {
    const contours = unionRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 50, w: 10, h: 10 }
    ]);

    assert.equal(contours.length, 2);
    assert.equal(contours[0].length, 4);
    assert.equal(contours[1].length, 4);

    // roundedUnion handles multiple contours by separating with space
    const path = roundedUnion([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 50, w: 10, h: 10 }
    ], { radius: 2 });

    const mMatches = path.match(/M/g);
    assert.equal(mMatches.length, 2, 'path should contain 2 M commands for disjoint shapes');
  });

  test('cross-shaped figure produces 12-vertex contour with 4 concave corners', () => {
    // Vertical bar: [10, 0, 10, 30], Horizontal bar: [0, 10, 30, 10]
    const contours = unionRects([
      { x: 10, y: 0, w: 10, h: 30 },
      { x: 0, y: 10, w: 30, h: 10 }
    ]);

    assert.equal(contours.length, 1);
    assert.equal(contours[0].length, 12);
  });

  test('quantizes coordinates so 232.4 and 232.4000001 merge without hairline step', () => {
    // Two blocks sharing an edge at 232.4 vs 232.4000001
    const rects = [
      { x: 0, y: 0, w: 232.4, h: 100 },
      { x: 232.4000001, y: 0, w: 100, h: 100 }
    ];
    const contours = unionRects(rects);
    assert.equal(contours.length, 1);
    // Should form a single rectangle with 4 vertices, no 0.0000001px step
    assert.equal(contours[0].length, 4);
    assert.deepEqual(contours[0], [
      { x: 0, y: 0 },
      { x: 332.4, y: 0 },
      { x: 332.4, y: 100 },
      { x: 0, y: 100 }
    ]);
  });
});
