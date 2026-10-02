import test from 'node:test';
import assert from 'node:assert';
import { parseAttrs } from '../src/core/attrs.js';

test('parseAttrs', async (t) => {
  await t.test('1. Basic axis - { scroll: "y" } → { axis: "y" }', () => {
    assert.deepStrictEqual(parseAttrs({ scroll: 'y' }), { axis: 'y' });
  });

  await t.test('2. Both axis - { scroll: "both" } → { axis: "both" }', () => {
    assert.deepStrictEqual(parseAttrs({ scroll: 'both' }), { axis: 'both' });
  });

  await t.test('3. Bare data-scroll - { scroll: "" } → { axis: "y" }', () => {
    assert.deepStrictEqual(parseAttrs({ scroll: '' }), { axis: 'y' });
  });

  await t.test('4. Visibility - { scroll: "y", scrollVisibility: "always" }', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollVisibility: 'always' }),
      { axis: 'y', visibility: 'always' }
    );
  });

  await t.test('5. Numeric values - scrollIdleDelay', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollIdleDelay: '1500' }),
      { axis: 'y', idleDelay: 1500 }
    );
  });

  await t.test('6. Boolean values - scrollHideWhenNoOverflow', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollHideWhenNoOverflow: 'false' }),
      { axis: 'y', hideWhenNoOverflow: false }
    );
  });

  await t.test('7. JSON values - scrollSmoothing', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollSmoothing: '{"offset":50,"size":100}' }),
      { axis: 'y', smoothing: { offset: 50, size: 100 } }
    );
  });

  await t.test('8. Mount selector', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'x', scrollMount: '#my-rail' }),
      { axis: 'x', mount: '#my-rail' }
    );
  });

  await t.test('9. Mount X/Y separately', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'both', scrollMountX: '#rail-x', scrollMountY: '#rail-y' }),
      { axis: 'both', mount: { x: '#rail-x', y: '#rail-y' } }
    );
  });

  await t.test('10. Preset', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollPreset: 'thin' }),
      { axis: 'y', preset: 'thin' }
    );
  });

  await t.test('11. ClassName', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollClassName: 'my-theme' }),
      { axis: 'y', className: 'my-theme' }
    );
  });

  await t.test('12. Multiple options', () => {
    assert.deepStrictEqual(
      parseAttrs({
        scroll: 'y',
        scrollPreset: 'thick',
        scrollFadeIn: '300',
        scrollHideWhenNoOverflow: 'true'
      }),
      {
        axis: 'y',
        preset: 'thick',
        fadeIn: 300,
        hideWhenNoOverflow: true
      }
    );
  });

  await t.test('13. Triggers as JSON', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollTriggers: '{"scroll":true,"hoverHost":false}' }),
      { axis: 'y', triggers: { scroll: true, hoverHost: false } }
    );
  });

  await t.test('14. Empty dataset', () => {
    assert.deepStrictEqual(parseAttrs({}), {});
  });

  await t.test('15. Non-scroll keys ignored', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', foo: 'bar', datasetId: '123' }),
      { axis: 'y' }
    );
  });

  await t.test('16. kebab-to-camel conversion check (scrollHorizontalWheel -> horizontalWheel)', () => {
    assert.deepStrictEqual(
      parseAttrs({ scroll: 'y', scrollHorizontalWheel: 'false' }),
      { axis: 'y', horizontalWheel: false }
    );
  });
});
