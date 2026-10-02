import test from 'node:test';
import assert from 'node:assert';
import {
  getDefaults, setDefaults, resetDefaults, definePreset, getPreset, mergeOptions, clearPresets
} from '../src/core/options.js';

test('options module tests', async (t) => {
  t.beforeEach(() => {
    resetDefaults();
    clearPresets();
  });

  await t.test('1. Default values - all defaults are correct', () => {
    const def = getDefaults();
    assert.strictEqual(def.axis, 'y');
    assert.strictEqual(def.visibility, 'auto');
    assert.strictEqual(def.idleDelay, 900);
  });

  await t.test('2. setDefaults overrides - user defaults override built-in', () => {
    setDefaults({ idleDelay: 1000, axis: 'x' });
    const merged = mergeOptions();
    assert.strictEqual(merged.idleDelay, 1000);
    assert.strictEqual(merged.axis, 'x');
  });

  await t.test('3. Preset options - preset overrides user defaults', () => {
    setDefaults({ axis: 'x' });
    definePreset('myPreset', { options: { axis: 'both' } });
    const merged = mergeOptions({ preset: 'myPreset' });
    assert.strictEqual(merged.axis, 'both');
  });

  await t.test('4. Explicit options - override everything', () => {
    definePreset('p1', { options: { axis: 'x' } });
    const merged = mergeOptions({ axis: 'both', preset: 'p1' }, { axis: 'y' });
    assert.strictEqual(merged.axis, 'both');
  });

  await t.test('5. Priority chain - DEFAULTS < setDefaults < preset < attrOpts < explicitOpts', () => {
    setDefaults({ idleDelay: 100 });
    definePreset('p1', { options: { idleDelay: 200 } });
    
    let merged = mergeOptions({}, { preset: 'p1', idleDelay: 300 });
    assert.strictEqual(merged.idleDelay, 300);

    merged = mergeOptions({ idleDelay: 400 }, { preset: 'p1', idleDelay: 300 });
    assert.strictEqual(merged.idleDelay, 400);
  });

  await t.test('6. Deep merge triggers - individual trigger fields merge correctly', () => {
    setDefaults({ triggers: { scroll: false } });
    definePreset('p1', { options: { triggers: { hoverHost: false } } });
    const merged = mergeOptions({ preset: 'p1', triggers: { drag: false } });
    assert.strictEqual(merged.triggers.scroll, false);
    assert.strictEqual(merged.triggers.hoverHost, false);
    assert.strictEqual(merged.triggers.hoverTrack, true);
    assert.strictEqual(merged.triggers.drag, false);
  });

  await t.test('7. Smoothing normalization - number -> { offset, size }', () => {
    const merged = mergeOptions({ smoothing: 50 });
    assert.deepStrictEqual(merged.smoothing, { offset: 50, size: 50 });
  });

  await t.test('8. Preset className - applied when no explicit className', () => {
    definePreset('p1', { className: 'preset-class' });
    const merged = mergeOptions({ preset: 'p1' });
    assert.strictEqual(merged.className, 'preset-class');
  });

  await t.test('9. Invalid values - warning and fallback to default', () => {
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    const merged = mergeOptions({ visibility: 'invalid' });
    console.warn = originalWarn;
    assert.strictEqual(warned, true);
    assert.strictEqual(merged.visibility, 'auto');
  });

  await t.test('10. Unknown preset - doesn\'t crash', () => {
    const merged = mergeOptions({ preset: 'unknown' });
    assert.strictEqual(merged.axis, 'y');
  });

  await t.test('11. resetDefaults - clears user defaults', () => {
    setDefaults({ axis: 'x' });
    resetDefaults();
    const merged = mergeOptions();
    assert.strictEqual(merged.axis, 'y');
  });

  await t.test('12. definePreset / getPreset - registry works', () => {
    definePreset('p2', { className: 'class2' });
    const p = getPreset('p2');
    assert.strictEqual(p.className, 'class2');
  });

  await t.test('13. Attr opts override user defaults but not explicit', () => {
    setDefaults({ idleDelay: 100 });
    const merged = mergeOptions({ idleDelay: 300 }, { idleDelay: 200 });
    assert.strictEqual(merged.idleDelay, 300);
    const merged2 = mergeOptions({}, { idleDelay: 200 });
    assert.strictEqual(merged2.idleDelay, 200);
  });

  await t.test('14. Multiple presets - registry holds multiple', () => {
    definePreset('p1', { className: 'c1' });
    definePreset('p2', { className: 'c2' });
    assert.strictEqual(getPreset('p1').className, 'c1');
    assert.strictEqual(getPreset('p2').className, 'c2');
  });
});
