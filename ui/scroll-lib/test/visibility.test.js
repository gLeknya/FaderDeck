import test from 'node:test';
import assert from 'node:assert';
import { 
  createVisibility, 
  visibilityEvent, 
  visibilityTimeout, 
  getVisibilityTarget, 
  updateVisibilityConfig 
} from '../src/core/visibility.js';

test('Visibility Machine', async (t) => {
  let now = 0;
  const clock = () => now;

  await t.test('Mode never - target always 0 regardless of events', () => {
    now = 0;
    const m = createVisibility({ mode: 'never', clock });
    assert.strictEqual(getVisibilityTarget(m), 0);

    const r1 = visibilityEvent(m, 'scroll');
    assert.strictEqual(r1.target, 0);
    assert.strictEqual(r1.needsTimer, false);

    const r2 = visibilityEvent(m, 'hoverHostEnter');
    assert.strictEqual(r2.target, 0);
  });

  await t.test('Mode always - target always 1', () => {
    now = 0;
    const m = createVisibility({ mode: 'always', clock });
    assert.strictEqual(getVisibilityTarget(m), 1);
  });

  await t.test('Mode always + hideWhenNoOverflow - target 0 when not scrollable', () => {
    now = 0;
    const m = createVisibility({ mode: 'always', clock, hideWhenNoOverflow: true });
    assert.strictEqual(getVisibilityTarget(m), 1);

    const r1 = visibilityEvent(m, 'overflowChange', { scrollable: false });
    assert.strictEqual(r1.target, 0);

    const r2 = visibilityEvent(m, 'overflowChange', { scrollable: true });
    assert.strictEqual(r2.target, 1);
  });

  await t.test('Mode hover - mouse enter host - target becomes 1', () => {
    now = 0;
    const m = createVisibility({ mode: 'hover', clock });
    assert.strictEqual(getVisibilityTarget(m), 0);

    const r = visibilityEvent(m, 'hoverHostEnter');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, false);
  });

  await t.test('Mode hover - mouse leave host - target becomes 0 after idleDelay', () => {
    now = 0;
    const m = createVisibility({ mode: 'hover', clock, idleDelay: 500 });
    visibilityEvent(m, 'hoverHostEnter');
    
    now = 100;
    const r = visibilityEvent(m, 'hoverHostLeave');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, true);
    assert.strictEqual(r.timerDelay, 500);

    now = 599;
    const r2 = visibilityTimeout(m, now);
    assert.strictEqual(r2.target, 1); // still 1

    now = 600;
    const r3 = visibilityTimeout(m, now);
    assert.strictEqual(r3.target, 0);
  });

  await t.test('Mode hover - mouse over track - stays visible', () => {
    now = 0;
    const m = createVisibility({ mode: 'hover', clock, idleDelay: 500 });
    visibilityEvent(m, 'hoverHostEnter');
    
    now = 100;
    const r = visibilityEvent(m, 'hoverTrackEnter');
    assert.strictEqual(r.target, 1);

    now = 200;
    const r2 = visibilityEvent(m, 'hoverHostLeave');
    // still hovering track
    assert.strictEqual(r2.target, 1);
    assert.strictEqual(r2.needsTimer, false);

    now = 1000;
    const r3 = visibilityTimeout(m, now);
    assert.strictEqual(r3.target, 1);
  });

  await t.test('Mode hover - dragging - stays visible regardless of mouse', () => {
    now = 0;
    const m = createVisibility({ mode: 'hover', clock, idleDelay: 500 });
    visibilityEvent(m, 'dragStart');
    assert.strictEqual(getVisibilityTarget(m), 1);

    now = 1000;
    const r = visibilityTimeout(m, now);
    assert.strictEqual(r.target, 1);
  });

  await t.test('Mode auto - scroll event - shows, then hides after idleDelay', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 500 });
    assert.strictEqual(getVisibilityTarget(m), 0);

    const r = visibilityEvent(m, 'scroll');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, true);
    assert.strictEqual(r.timerDelay, 500);

    now = 500;
    const r2 = visibilityTimeout(m, now);
    assert.strictEqual(r2.target, 0);
  });

  await t.test('Mode auto - multiple scroll events - timer resets on each scroll', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 500 });
    visibilityEvent(m, 'scroll');
    
    now = 400;
    const r = visibilityEvent(m, 'scroll');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, true);
    assert.strictEqual(r.timerDelay, 500); // from 400

    now = 800;
    const r2 = visibilityTimeout(m, now);
    assert.strictEqual(r2.target, 1); // 400 elapsed, < 500

    now = 900;
    const r3 = visibilityTimeout(m, now);
    assert.strictEqual(r3.target, 0);
  });

  await t.test('Mode auto - hover track prevents hiding - timer doesn\'t fire while hovering track', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 500 });
    visibilityEvent(m, 'scroll');

    now = 100;
    const r = visibilityEvent(m, 'hoverTrackEnter');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, false);

    now = 1000;
    const r2 = visibilityTimeout(m, now);
    assert.strictEqual(r2.target, 1);
  });

  await t.test('Mode auto - drag prevents hiding - stays visible during drag', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 500 });
    visibilityEvent(m, 'dragStart');
    
    const r = visibilityEvent(m, 'scroll');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, false);
  });

  await t.test('Mode auto - disabled triggers - disabled trigger events are ignored', () => {
    now = 0;
    const m = createVisibility({ 
      mode: 'auto', 
      clock, 
      triggers: { scroll: false } // scroll disabled
    });
    const r = visibilityEvent(m, 'scroll');
    assert.strictEqual(r.target, 0);
    assert.strictEqual(r.needsTimer, false);
  });

  await t.test('Mode auto - resize trigger - shows on resize', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 500 });
    const r = visibilityEvent(m, 'resize');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, true);
    assert.strictEqual(r.timerDelay, 500);
  });

  await t.test('hideWhenNoOverflow - overrides all modes when not scrollable', () => {
    now = 0;
    const m = createVisibility({ mode: 'always', clock, hideWhenNoOverflow: true });
    visibilityEvent(m, 'overflowChange', { scrollable: false });
    assert.strictEqual(getVisibilityTarget(m), 0);

    const r = visibilityEvent(m, 'hoverHostEnter');
    assert.strictEqual(r.target, 0); // still 0
  });

  await t.test('overflowChange event - updates scrollable state', () => {
    now = 0;
    const m = createVisibility({ mode: 'always', clock, hideWhenNoOverflow: true });
    assert.strictEqual(getVisibilityTarget(m), 1);
    
    visibilityEvent(m, 'overflowChange', { scrollable: false });
    assert.strictEqual(getVisibilityTarget(m), 0);
  });

  await t.test('Config update - changing mode mid-life works', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 500 });
    visibilityEvent(m, 'scroll');
    assert.strictEqual(getVisibilityTarget(m), 1);

    now = 100;
    updateVisibilityConfig(m, { mode: 'never' });
    assert.strictEqual(getVisibilityTarget(m), 0);

    updateVisibilityConfig(m, { mode: 'always' });
    assert.strictEqual(getVisibilityTarget(m), 1);
  });

  await t.test('Idle delay timing - precise timer behavior', () => {
    now = 0;
    const m = createVisibility({ mode: 'auto', clock, idleDelay: 300 });
    visibilityEvent(m, 'hoverHostEnter');
    
    now = 100;
    const r = visibilityEvent(m, 'hoverHostLeave');
    assert.strictEqual(r.target, 1);
    assert.strictEqual(r.needsTimer, true);
    assert.strictEqual(r.timerDelay, 300);

    now = 399;
    assert.strictEqual(visibilityTimeout(m, now).target, 1);

    now = 400;
    assert.strictEqual(visibilityTimeout(m, now).target, 0);
  });

});
