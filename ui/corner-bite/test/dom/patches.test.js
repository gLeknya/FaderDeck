import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPatchesPath, buildPatchesArcPath, resolvePatchColor } from '../../src/dom/patches.js';

describe('patches mode', () => {
  test('buildPatchesPath generates wedge overlays at concave corners', () => {
    // L-shaped configuration of two touching rects
    // Rect 1: [0, 0, 100, 100]
    // Rect 2: [100, 40, 60, 60]
    // Concave corner is at (100, 40)
    const rects = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 40, w: 60, h: 60 }
    ];

    const patchPath = buildPatchesPath(rects, { radius: 10, concaveRadius: 10 });
    assert.ok(patchPath.length > 0, 'should generate patch path');

    // Should contain M, L, L, A, Z
    const commands = patchPath.match(/[MLAZ]/g);
    assert.deepEqual(commands, ['M', 'L', 'L', 'A', 'Z']);

    // The wedge arc has sweep 1 (curving back along the bite)
    assert.ok(patchPath.includes(' 0 0 1 '));
  });

  test('buildPatchesArcPath generates stroke arc path at concave corners', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 40, w: 60, h: 60 }
    ];

    const arcPath = buildPatchesArcPath(rects, { radius: 10, concaveRadius: 10 });
    assert.ok(arcPath.length > 0, 'should generate arc path');

    // Should contain M, A (no L, no Z)
    const commands = arcPath.match(/[MLAZ]/g);
    assert.deepEqual(commands, ['M', 'A']);
    assert.ok(arcPath.includes(' 0 0 1 '));
  });

  test('buildPatchesPath returns empty string if no concave corners', () => {
    // Single rectangle has only convex corners
    const rects = [{ x: 0, y: 0, w: 100, h: 100 }];
    const patchPath = buildPatchesPath(rects, { radius: 10 });
    assert.equal(patchPath, '');

    const arcPath = buildPatchesArcPath(rects, { radius: 10 });
    assert.equal(arcPath, '');
  });

  test('resolvePatchColor honors explicit color and fallbacks', () => {
    assert.equal(resolvePatchColor([], '#ff0000'), '#ff0000');
    assert.equal(resolvePatchColor([]), 'currentColor');
  });

  test('patchStrokeInset shifts arc and wedge to match border centerlines', () => {
    const rects = [
      { x: 0, y: 0, w: 960, h: 34 },
      { x: 0, y: 34, w: 72, h: 506 }
    ];

    const arcPath = buildPatchesArcPath(rects, {
      radius: 0,
      concaveRadius: 32,
      patchStrokeInset: 0.5
    });

    assert.equal(arcPath, 'M 71.5 65.5 A 32 32 0 0 1 103.5 33.5');

    const patchPath = buildPatchesPath(rects, {
      radius: 0,
      concaveRadius: 32,
      patchStrokeInset: 0.5
    });

    // pStart: (103.5, 33.5), tucked innerVx: (70, 32), pEnd: (71.5, 65.5)
    assert.equal(patchPath, 'M 103.5 33.5 L 70 32 L 71.5 65.5 A 32 32 0 0 1 103.5 33.5 Z');
  });

  test('patchStrokeExtension adds straight tangential extensions at endpoints', () => {
    const rects = [
      { x: 0, y: 0, w: 960, h: 34 },
      { x: 0, y: 34, w: 72, h: 506 }
    ];

    const arcPath = buildPatchesArcPath(rects, {
      radius: 0,
      concaveRadius: 32,
      patchStrokeInset: 0.5,
      patchStrokeExtension: 0.75
    });

    assert.equal(arcPath, 'M 71.5 66.25 L 71.5 65.5 A 32 32 0 0 1 103.5 33.5 L 104.25 33.5');
  });
});
