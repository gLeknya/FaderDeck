import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeGeometry, scrollFromOffset } from '../src/core/geometry.js';

describe('Geometry Core', () => {
  describe('computeGeometry', () => {
    it('Basic geometry - normal case, thumb size proportional to viewport/content ratio', () => {
      const res = computeGeometry({ viewport: 100, content: 500, scroll: 0, track: 100, minThumb: 10 });
      assert.equal(res.maxScroll, 400);
      assert.equal(res.scrollable, true);
      assert.equal(res.size, 20); // 100 * (100 / 500)
      assert.equal(res.offset, 0);
    });

    it('Full content visible', () => {
      const res = computeGeometry({ viewport: 100, content: 100, scroll: 0, track: 100, minThumb: 10 });
      assert.equal(res.maxScroll, 0);
      assert.equal(res.scrollable, false);
      assert.equal(res.size, 100);
      assert.equal(res.offset, 0);
    });

    it('Scroll at start', () => {
      const res = computeGeometry({ viewport: 100, content: 200, scroll: 0, track: 100, minThumb: 10 });
      assert.equal(res.offset, 0);
    });

    it('Scroll at end', () => {
      const res = computeGeometry({ viewport: 100, content: 200, scroll: 100, track: 100, minThumb: 10 });
      assert.equal(res.maxScroll, 100);
      assert.equal(res.size, 50);
      assert.equal(res.offset, 50);
    });

    it('Scroll at middle', () => {
      const res = computeGeometry({ viewport: 100, content: 500, scroll: 200, track: 100, minThumb: 10 });
      assert.equal(res.size, 20);
      assert.equal(res.offset, 40); // 0.5 * 80
    });

    it('minThumb enforcement', () => {
      const res = computeGeometry({ viewport: 100, content: 10000, scroll: 0, track: 100, minThumb: 15 });
      assert.equal(res.size, 15);
    });

    it('minThumb larger than track', () => {
      const res = computeGeometry({ viewport: 100, content: 1000, scroll: 0, track: 20, minThumb: 30 });
      assert.equal(res.size, 20);
      assert.equal(res.offset, 0);
    });

    it('Zero content/viewport - handle gracefully', () => {
      const res = computeGeometry({ viewport: 0, content: 0, scroll: 0, track: 100, minThumb: 10 });
      assert.equal(res.maxScroll, 0);
      assert.equal(res.scrollable, false);
      assert.ok(Number.isNaN(res.size));
      assert.equal(res.offset, 0);
    });

    it('Fractional sizes', () => {
      const res = computeGeometry({ viewport: 100, content: 100.4, scroll: 0, track: 100, minThumb: 10 });
      assert.equal(res.scrollable, false); // 0.4 < 0.5
      assert.equal(res.offset, 0);
    });

    it('Safari overscroll', () => {
      const res1 = computeGeometry({ viewport: 100, content: 200, scroll: -50, track: 100, minThumb: 10 });
      assert.equal(res1.offset, 0);

      const res2 = computeGeometry({ viewport: 100, content: 200, scroll: 150, track: 100, minThumb: 10 });
      assert.equal(res2.offset, 50);
    });
    
    it('Edge case: content barely larger than viewport', () => {
      const res = computeGeometry({ viewport: 100, content: 100.51, scroll: 0, track: 100, minThumb: 10 });
      assert.equal(res.scrollable, true);
    });
  });

  describe('scrollFromOffset', () => {
    it('Inverse function (scrollFromOffset) - round-trip', () => {
      const input = { viewport: 100, content: 500, track: 100, minThumb: 10 };
      const scroll = 123;
      const geo = computeGeometry({ ...input, scroll });
      const inverseScroll = scrollFromOffset({ offset: geo.offset, track: input.track, size: geo.size, maxScroll: geo.maxScroll });
      assert.ok(Math.abs(scroll - inverseScroll) < 0.001);
    });

    it('Inverse with zero range', () => {
      const scroll = scrollFromOffset({ offset: 10, track: 100, size: 100, maxScroll: 100 });
      assert.equal(scroll, 0);
    });
  });
});
