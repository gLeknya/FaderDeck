import { test } from 'node:test';
import assert from 'node:assert';
import { 
  smoothStep, 
  createTweenState, 
  tweenSetTarget, 
  tweenStep, 
  createEngineState, 
  engineStep, 
  resolveEasing 
} from '../src/core/engine.js';

test('engine.js module', async (t) => {
  await t.test('smoothStep convergence', () => {
    let current = 0;
    const target = 100;
    const dt = 16;
    const tau = 50;
    
    for (let i = 0; i < 10; i++) {
      current = smoothStep(current, target, dt, tau).value;
    }
    
    assert.ok(current > 90, 'value should converge towards target');
    assert.ok(current < 100, 'value should not exceed target');
  });

  await t.test('smoothStep frame-rate independence', () => {
    const target = 100;
    const tau = 50;
    
    const resBig = smoothStep(0, target, 64, tau);
    
    let currentSmall = 0;
    for (let i = 0; i < 4; i++) {
      currentSmall = smoothStep(currentSmall, target, 16, tau).value;
    }
    
    assert.ok(Math.abs(resBig.value - currentSmall) < 0.1, 'should be approximately independent of frame rate');
  });

  await t.test('smoothStep snap', () => {
    const res = smoothStep(99.95, 100, 16, 50);
    assert.strictEqual(res.value, 100);
    assert.strictEqual(res.settled, true);
  });

  await t.test('smoothStep tau=0', () => {
    const res = smoothStep(0, 100, 16, 0);
    assert.strictEqual(res.value, 100);
    assert.strictEqual(res.settled, true);
  });

  await t.test('smoothStep negative dt', () => {
    const res = smoothStep(0, 100, -16, 50);
    assert.strictEqual(res.value, 100);
    assert.strictEqual(res.settled, true);
  });

  await t.test('Tween basic', () => {
    let state = createTweenState(0, 'linear');
    state = tweenSetTarget(state, 1, 100, 'linear');
    
    const res1 = tweenStep(state, 50);
    assert.strictEqual(res1.state.value, 0.5);
    assert.strictEqual(res1.settled, false);
    
    const res2 = tweenStep(res1.state, 50);
    assert.strictEqual(res2.state.value, 1);
    assert.strictEqual(res2.settled, true);
  });

  await t.test('Tween mid-animation reversal', () => {
    let state = createTweenState(0, 'linear');
    state = tweenSetTarget(state, 1, 100, 'linear');
    
    let res = tweenStep(state, 50);
    
    state = tweenSetTarget(res.state, 0, 100, 'linear');
    assert.strictEqual(state.startValue, 0.5);
    
    res = tweenStep(state, 50);
    assert.strictEqual(res.state.value, 0.25);
  });

  await t.test('Tween duration=0', () => {
    let state = createTweenState(0, 'linear');
    state = tweenSetTarget(state, 1, 0, 'linear');
    const res = tweenStep(state, 16);
    assert.strictEqual(res.state.value, 1);
    assert.strictEqual(res.settled, true);
  });

  await t.test('Tween already at target', () => {
    let state = createTweenState(1, 'linear');
    const res = tweenStep(state, 16);
    assert.strictEqual(res.state.value, 1);
    assert.strictEqual(res.settled, true);
  });

  await t.test('Tween easing', () => {
    let state = createTweenState(0, 'ease-out');
    state = tweenSetTarget(state, 1, 100, 'ease-out');
    const res = tweenStep(state, 50);
    assert.strictEqual(res.state.value, 0.75);
  });

  await t.test('Tween custom easing function', () => {
    const customEasing = t => t ** 3;
    let state = createTweenState(0, customEasing);
    state = tweenSetTarget(state, 1, 100, customEasing);
    const res = tweenStep(state, 50);
    assert.strictEqual(res.state.value, 0.125);
  });

  await t.test('engineStep combined', () => {
    const state = createEngineState();
    const targets = { offset: 100, size: 50, presence: 1 };
    const params = {
      smoothOffset: 50,
      smoothSize: 50,
      fadeIn: 100,
      fadeOut: 100,
      easing: 'linear',
      dragging: false
    };
    
    const res = engineStep(state, targets, 50, params);
    
    assert.strictEqual(res.settled, false);
    assert.ok(res.state.offset.value > 0);
    assert.ok(res.state.size.value > 0);
    assert.strictEqual(res.state.presence.value, 0.5);
    assert.strictEqual(res.changed.offset, true);
    assert.strictEqual(res.changed.size, true);
    assert.strictEqual(res.changed.presence, true);
  });

  await t.test('engineStep dragging bypass', () => {
    const state = createEngineState();
    const targets = { offset: 100, size: 50, presence: 1 };
    const params = {
      smoothOffset: 50,
      smoothSize: 50,
      fadeIn: 100,
      fadeOut: 100,
      easing: 'linear',
      dragging: true
    };
    
    const res = engineStep(state, targets, 16, params);
    
    assert.strictEqual(res.state.offset.value, 100);
    assert.strictEqual(res.state.offset.target, 100);
    assert.ok(res.state.size.value > 0 && res.state.size.value < 50);
  });

  await t.test('engineStep settled detection', () => {
    let state = createEngineState();
    const targets = { offset: 100, size: 50, presence: 1 };
    const params = {
      smoothOffset: 1, // snap quickly
      smoothSize: 1,
      fadeIn: 16,
      fadeOut: 16,
      easing: 'linear',
      dragging: false
    };
    
    let res = engineStep(state, targets, 16, params);
    assert.strictEqual(res.settled, true);
    assert.strictEqual(res.state.offset.value, 100);
    assert.strictEqual(res.state.size.value, 50);
    assert.strictEqual(res.state.presence.value, 1);
  });

  await t.test('Easing resolution', () => {
    const linear = resolveEasing('linear');
    assert.strictEqual(linear(0.5), 0.5);
    
    const unknown = resolveEasing('invalid-easing');
    assert.strictEqual(unknown(0.5), 0.75);
    
    const custom = (t) => t * 2;
    assert.strictEqual(resolveEasing(custom), custom);
  });
});
