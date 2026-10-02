import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, calculateFillets } from '../../src/index.js';

describe('Fillet corner rounding', () => {
  test('single rectangle: path structure and convex sweep flags', () => {
    // 100x100 rectangle, CW
    const rect = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    const fillets = calculateFillets(rect, { radius: 10 });
    assert.equal(fillets.length, 4);

    for (const f of fillets) {
      assert.equal(f.isConcave, false, 'all rectangle corners should be convex');
      assert.equal(f.sweep, 1, 'convex corners should have sweep-flag 1');
      assert.equal(f.r, 10, 'radius should equal 10');
      assert.equal(f.t, 10, 'for 90 deg corner, t should equal r');
    }

    const path = buildPath(rect, { radius: 10 });
    // Structure: M followed by 4 pairs of L and A, ending with Z
    const commands = path.match(/[MLAZ]/g);
    assert.deepEqual(commands, ['M', 'L', 'A', 'L', 'A', 'L', 'A', 'L', 'A', 'Z']);

    // Check sweep flags in path
    const arcMatches = [...path.matchAll(/A\s+([\d.]+)\s+([\d.]+)\s+0\s+0\s+([01])\s+([\d.]+)\s+([\d.]+)/g)];
    assert.equal(arcMatches.length, 4);
    for (const m of arcMatches) {
      assert.equal(m[3], '1', 'arc sweep should be 1');
    }
  });

  test('L-shaped figure: concave corner has reverse sweep, correct endpoints and center', () => {
    // L-shaped polygon with an inner corner at (10, 10)
    // (0,0) -> (20,0) -> (20,10) -> (10,10) -> (10,20) -> (0,20)
    const lShape = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 }
    ];

    const r = 4;
    const fillets = calculateFillets(lShape, { radius: r, concaveRadius: r });
    assert.equal(fillets.length, 6);

    // Vertex index 3 is (10, 10)
    const concaveFillet = fillets[3];
    assert.equal(concaveFillet.isConcave, true, 'inner corner must be concave');
    assert.equal(concaveFillet.sweep, 0, 'concave arc must have reverse sweep 0');

    // For 90 degree concave corner, t = r
    assert.equal(concaveFillet.t, r);
    assert.equal(concaveFillet.r, r);

    // Endpoints:
    // Incoming edge from (20, 10) to (10, 10): pStart lies at (10 + r, 10)
    assert.equal(concaveFillet.pStart.x, 10 + r);
    assert.equal(concaveFillet.pStart.y, 10);

    // Outgoing edge from (10, 10) to (10, 20): pEnd lies at (10, 10 + r)
    assert.equal(concaveFillet.pEnd.x, 10);
    assert.equal(concaveFillet.pEnd.y, 10 + r);

    // Center of concave fillet: at (10 + r, 10 + r)
    assert.equal(concaveFillet.center.x, 10 + r);
    assert.equal(concaveFillet.center.y, 10 + r);

    // Check distance from center to incoming line (y = 10): |10+r - 10| = r
    assert.equal(Math.abs(concaveFillet.center.y - 10), r);
    // Distance from center to outgoing line (x = 10): |10+r - 10| = r
    assert.equal(Math.abs(concaveFillet.center.x - 10), r);

    // In path string, concave corner has sweep 0
    const path = buildPath(lShape, { radius: r, concaveRadius: r });
    const sweeps = [...path.matchAll(/A\s+[\d.]+\s+[\d.]+\s+0\s+0\s+([01])/g)].map(m => m[1]);
    assert.deepEqual(sweeps, ['1', '1', '1', '0', '1', '1']);
  });

  test('non-rectangular angles: formula t = r / tan(theta / 2)', () => {
    // Equilateral triangle with side 100
    // Vertices in CW order: (50, 0), (100, 86.60254), (0, 86.60254)
    const h = 50 * Math.sqrt(3);
    const triangle = [
      { x: 50, y: 0 },
      { x: 100, y: h },
      { x: 0, y: h }
    ];

    const r = 10;
    const fillets = calculateFillets(triangle, { radius: r });
    assert.equal(fillets.length, 3);

    // For equilateral triangle, each interior angle theta = 60 deg = PI/3
    // t = r / tan(30 deg) = r * sqrt(3)
    const expectedT = r * Math.sqrt(3);

    for (const f of fillets) {
      assert.ok(Math.abs(f.t - expectedT) < 1e-4, `Expected t ~ ${expectedT}, got ${f.t}`);
      assert.equal(f.sweep, 1);
    }

    // Chevron (arrow shape with non-90-degree concave angle)
    const chevron = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 100 },
      { x: 40, y: 50 } // Concave reflex corner
    ];

    const chevronFillets = calculateFillets(chevron, { radius: 5, concaveRadius: 5 });
    const concaveF = chevronFillets[3];
    assert.equal(concaveF.isConcave, true);
    assert.equal(concaveF.sweep, 0);

    // Tangent distance matches t = r / tan(theta / 2)
    // Ray 1: (0, 100) -> (40, 50), vector (-40, 50), len = sqrt(4100)
    // Ray 2: (0, 0) -> (40, 50), vector (-40, -50), len = sqrt(4100)
    // cos(theta) = (-40 * -40 + 50 * -50) / 4100 = (1600 - 2500) / 4100 = -900 / 4100 = -9/41
    const cosTheta = -9 / 41;
    const theta = Math.acos(cosTheta);
    const expectedChevronT = 5 / Math.tan(theta / 2);
    assert.ok(Math.abs(concaveF.t - expectedChevronT) < 1e-4, `Expected t ~ ${expectedChevronT}, got ${concaveF.t}`);
  });

  test('auto radius limit: excessively large radius scales down and arcs never overlap', () => {
    // Rectangle with side lengths 20 and 100
    const rect = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 100 },
      { x: 0, y: 100 }
    ];

    // Requesting r = 50 on an edge of length 20!
    // Sum of target tangents on top edge is 50 + 50 = 100 > 20
    const fillets = calculateFillets(rect, { radius: 50 });

    // Edge 0 (from (0,0) to (20,0)) has length 20
    // Vertices 0 and 1 share edge 0
    const f0 = fillets[0];
    const f1 = fillets[1];

    // Effective tangents on edge 0 must satisfy t0 + t1 <= 20
    assert.ok(f0.t + f1.t <= 20 + 1e-9, `Sum of tangents (${f0.t + f1.t}) exceeds edge length 20`);
    // Scaled down proportionally
    assert.ok(Math.abs(f0.t - 10) < 1e-4, `Expected t to scale down to 10, got ${f0.t}`);
    assert.ok(Math.abs(f1.t - 10) < 1e-4, `Expected t to scale down to 10, got ${f1.t}`);

    // Endpoints do not overlap:
    // f0.pEnd on edge 0: (0 + 10, 0) = (10, 0)
    // f1.pStart on edge 0: (20 - 10, 0) = (10, 0)
    assert.ok(Math.abs(f0.pEnd.x - f1.pStart.x) < 1e-4);
  });

  test('fixed path structure: r = 0 gives the exact same command sequence as r > 0', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 80, y: 40 },
      { x: 20, y: 60 }
    ];

    const pathZero = buildPath(polygon, { radius: 0 });
    const pathRounded = buildPath(polygon, { radius: 15 });

    const commandsZero = pathZero.match(/[MLAZ]/g);
    const commandsRounded = pathRounded.match(/[MLAZ]/g);

    assert.deepEqual(commandsZero, commandsRounded);
    assert.deepEqual(commandsZero, ['M', 'L', 'A', 'L', 'A', 'L', 'A', 'L', 'A', 'Z']);
  });
});
