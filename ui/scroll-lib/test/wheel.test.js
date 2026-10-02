import test from 'node:test';
import assert from 'node:assert';
import { decideWheel, normalizeDelta } from '../src/core/wheel.js';

test('wheel module tests', async (t) => {
  await t.test('1. ctrlKey - never handled (zoom)', () => {
    const res = decideWheel({ ctrlKey: true, deltaY: 100, deltaMode: 0, hasX: true });
    assert.strictEqual(res.handled, false);
  });

  await t.test('2. Horizontal trackpad gesture - |deltaX| >= |deltaY|, not handled', () => {
    const res = decideWheel({ deltaX: 100, deltaY: 50, deltaMode: 0, hasX: true });
    assert.strictEqual(res.handled, false);
  });

  await t.test('3. shiftKey - not handled (browser converts)', () => {
    const res = decideWheel({ shiftKey: true, deltaY: 100, deltaMode: 0, hasX: true });
    assert.strictEqual(res.handled, false);
  });

  await t.test('4. Mode "shift" - never handled', () => {
    const res = decideWheel({ horizontalWheel: 'shift', deltaY: 100, deltaMode: 0, hasX: true });
    assert.strictEqual(res.handled, false);
  });

  await t.test('5. Mode "always" basic - vertical wheel -> horizontal scroll', () => {
    const res = decideWheel({
      deltaY: 100, deltaMode: 0, horizontalWheel: 'always',
      hasX: true, scrollLeft: 50, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.dx, 100);
    assert.strictEqual(res.dy, 0);
  });

  await t.test('6. Mode "always" at right edge - not handled (prevent page sticking)', () => {
    const res = decideWheel({
      deltaY: 100, deltaMode: 0, horizontalWheel: 'always',
      hasX: true, scrollLeft: 200, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, false);
  });

  await t.test('7. Mode "always" at left edge - not handled', () => {
    const res = decideWheel({
      deltaY: -100, deltaMode: 0, horizontalWheel: 'always',
      hasX: true, scrollLeft: 0, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, false);
  });

  await t.test('8. Mode "always" in middle - handled', () => {
    const res = decideWheel({
      deltaY: -100, deltaMode: 0, horizontalWheel: 'always',
      hasX: true, scrollLeft: 50, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.dx, -100);
  });

  await t.test('9. Mode "auto" with vertical overflow - not handled (uses native vertical)', () => {
    const res = decideWheel({
      deltaY: 100, deltaMode: 0, horizontalWheel: 'auto',
      hasX: true, hasY: true, maxScrollY: 100, scrollLeft: 50, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, false);
  });

  await t.test('10. Mode "auto" without vertical overflow - handled (converts to horizontal)', () => {
    const res = decideWheel({
      deltaY: 100, deltaMode: 0, horizontalWheel: 'auto',
      hasX: true, hasY: true, maxScrollY: 0, scrollLeft: 50, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.dx, 100);
  });

  await t.test('11. No X axis - not handled regardless of mode', () => {
    const res = decideWheel({
      deltaY: 100, deltaMode: 0, horizontalWheel: 'always',
      hasX: false, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, false);
  });

  await t.test('12. deltaMode line - converts correctly', () => {
    const res = decideWheel({
      deltaY: 2, deltaMode: 1, horizontalWheel: 'always',
      hasX: true, scrollLeft: 50, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.dx, 80); // 2 * 40
  });

  await t.test('13. deltaMode page - converts correctly', () => {
    const res = decideWheel({
      deltaY: 1, deltaMode: 2, horizontalWheel: 'always',
      hasX: true, scrollLeft: 50, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.dx, 800 * 0.8); // 1 * 800 * 0.8
  });

  await t.test('14. normalizeDelta - direct tests', () => {
    assert.strictEqual(normalizeDelta(10, 0, 1000), 10);
    assert.strictEqual(normalizeDelta(2, 1, 1000), 80);
    assert.strictEqual(normalizeDelta(1, 2, 1000), 800);
  });

  await t.test('15. Negative deltaY - scroll left correctly', () => {
    const res = decideWheel({
      deltaY: -50, deltaMode: 0, horizontalWheel: 'always',
      hasX: true, scrollLeft: 100, maxScrollX: 200, viewportWidth: 1000, viewportHeight: 800
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.dx, -50);
  });
});
