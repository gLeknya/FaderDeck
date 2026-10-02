import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, unionRects, roundedUnion } from '../../src/index.js';

describe('Validation', () => {
  describe('buildPath input validation', () => {
    test('rejects non-array input', () => {
      assert.throws(() => buildPath(null), /must be an array/);
      assert.throws(() => buildPath(123), /must be an array/);
    });

    test('rejects polygon with less than 3 vertices', () => {
      assert.throws(() => buildPath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), /at least 3 vertices/);
    });

    test('rejects vertex with NaN or non-finite coordinates', () => {
      assert.throws(() => buildPath([
        { x: 0, y: 0 },
        { x: NaN, y: 10 },
        { x: 10, y: 10 }
      ]), /invalid x: NaN/);

      assert.throws(() => buildPath([
        { x: 0, y: 0 },
        { x: 10, y: Infinity },
        { x: 10, y: 10 }
      ]), /invalid y: Infinity/);
    });

    test('rejects negative or NaN per-vertex radius', () => {
      assert.throws(() => buildPath([
        { x: 0, y: 0, r: -5 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ]), /cannot be negative/);

      assert.throws(() => buildPath([
        { x: 0, y: 0, r: NaN },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ]), /invalid radius override/);
    });

    test('rejects negative or NaN options radius and concaveRadius', () => {
      const vertices = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
      assert.throws(() => buildPath(vertices, { radius: -1 }), /cannot be negative/);
      assert.throws(() => buildPath(vertices, { radius: NaN }), /must be a valid number/);
      assert.throws(() => buildPath(vertices, { concaveRadius: -2 }), /cannot be negative/);
      assert.throws(() => buildPath(vertices, { concaveRadius: NaN }), /must be a valid number/);
      assert.throws(() => buildPath(vertices, { precision: -1 }), /must be a non-negative number/);
    });
  });

  describe('unionRects input validation', () => {
    test('rejects non-array or empty array', () => {
      assert.throws(() => unionRects(null), /must be an array/);
      assert.throws(() => unionRects([]), /cannot be empty/);
    });

    test('rejects rectangle with non-positive dimensions', () => {
      assert.throws(() => unionRects([{ x: 0, y: 0, w: 0, h: 10 }]), /width must be a positive finite number/);
      assert.throws(() => unionRects([{ x: 0, y: 0, w: 10, h: -5 }]), /height must be a positive finite number/);
    });

    test('rejects rectangle with NaN coordinates', () => {
      assert.throws(() => unionRects([{ x: NaN, y: 0, w: 10, h: 10 }]), /invalid x: NaN/);
      assert.throws(() => unionRects([{ x: 0, y: 0, w: NaN, h: 10 }]), /width must be a positive finite number/);
    });
  });
});
