import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFillets } from '../../src/core/fillet.js';

describe('Fillet contactLimit on non-90 degree concave corner', () => {
  test('arc remains strictly tangent to both edges when contactLimit restricts fillet on non-90 degree corner', () => {
    // CW polygon with a concave corner at (0, 0)
    // v0: (100, 0)
    // v1: (0, 0) with contactLimit = 15
    // v2: (50, 100)
    // v3: (200, 100)
    // v4: (200, -50)
    // v5: (100, -50)
    // Polygon is CW:
    // v0 -> v1: (-100, 0)
    // v1 -> v2: (50, 100), cp = -100*100 - 0 = -10000 < 0 -> CONCAVE!
    // Angle between rays: u1 = (1, 0), u2 = (50/sqrt(12500), 100/sqrt(12500))
    // cos(theta) = 50/sqrt(12500) = 1/sqrt(5) ≈ 0.4472 => theta ≈ 63.43°
    // tan(theta/2) ≈ 0.618034 (distinctly != 1)
    const polygon = [
      { x: 100, y: 0 },
      { x: 0, y: 0, contactLimit: 15 },
      { x: 50, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: -50 },
      { x: 100, y: -50 }
    ];

    // Request concave radius 40
    // Unclamped tangent would be t = 40 / tan(theta/2) ≈ 40 / 0.618 ≈ 64.72
    // With contactLimit = 15, tangent must be clamped to t = 15
    // And for tangency to hold, radius r MUST be recalculated as r = t * tan(theta/2) ≈ 15 * 0.618 ≈ 9.27
    const fillets = calculateFillets(polygon, { concaveRadius: 40 });
    const corner = fillets[1];

    assert.ok(corner.isConcave, 'Corner 1 must be concave');
    assert.ok(corner.t <= 15 + 1e-6, `t (${corner.t}) must be <= contactLimit (15)`);

    // The arc center must be equidistant to both endpoints with radius r
    const distToStart = Math.hypot(corner.center.x - corner.pStart.x, corner.center.y - corner.pStart.y);
    const distToEnd = Math.hypot(corner.center.x - corner.pEnd.x, corner.center.y - corner.pEnd.y);

    assert.ok(
      Math.abs(distToStart - corner.r) < 1e-4,
      `distToStart (${distToStart}) must equal r (${corner.r})`
    );

    // Tangency requirement: distance to pEnd must ALSO equal r!
    assert.ok(
      Math.abs(distToEnd - corner.r) < 1e-4,
      `distToEnd (${distToEnd}) must equal r (${corner.r}). Difference: ${Math.abs(distToEnd - corner.r)}`
    );
  });
});
