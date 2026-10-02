import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, roundedUnion } from '../../src/core/path.js';
import { calculateFillets } from '../../src/core/fillet.js';

describe('Finite path validation and NaN fallback', () => {
  test('calculateFillets does not throw or produce NaN on degenerate zero-length edges', () => {
    // Polygon with duplicate / zero-length edge
    const vertices = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 }, // duplicate vertex -> lenIn or lenOut = 0
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    const fillets = calculateFillets(vertices, { radius: 10 });
    assert.strictEqual(fillets.length, vertices.length);

    for (const f of fillets) {
      assert.ok(Number.isFinite(f.pStart.x), 'pStart.x must be finite');
      assert.ok(Number.isFinite(f.pStart.y), 'pStart.y must be finite');
      assert.ok(Number.isFinite(f.pEnd.x), 'pEnd.x must be finite');
      assert.ok(Number.isFinite(f.pEnd.y), 'pEnd.y must be finite');
      assert.ok(Number.isFinite(f.center.x), 'center.x must be finite');
      assert.ok(Number.isFinite(f.center.y), 'center.y must be finite');
      assert.ok(Number.isFinite(f.r), 'r must be finite');
    }
  });

  test('buildPath validates all numbers in d are finite; warns and returns last valid d if not', () => {
    // 1. First call with valid geometry to set baseline valid d
    const validSquare = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];
    const validD = buildPath(validSquare, { radius: 10 });
    assert.ok(validD.length > 0);
    assert.ok(!validD.includes('NaN'));
    assert.ok(!validD.includes('Infinity'));

    // Intercept console.warn
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);

    try {
      // 2. Geometry that produces NaN in fillet calculation
      const nanProducingPolygon = [
        { x: 0, y: 0 },
        { x: 1e308, y: 1e308 },
        { x: -1e308, y: 1e308 }
      ];

      const fallbackResult = buildPath(nanProducingPolygon, { radius: 10 });

      // Should return previous valid path and emit warning with context
      assert.strictEqual(fallbackResult, validD, 'Must return last valid d on NaN path');
      assert.ok(warnings.length > 0, 'console.warn should have been called');
      const warnObj = warnings[0][1];
      assert.ok(warnObj, 'Warning should have context object');
      assert.strictEqual(warnObj.lastValidPath, validD);
      assert.ok('brokenCorner' in warnObj, 'Warning should have brokenCorner property');
    } finally {
      console.warn = originalWarn;
    }
  });
});
