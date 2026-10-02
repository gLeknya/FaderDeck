import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setGradient } from '../../src/render/gradient.js';

function createMockSvg() {
  const children = [];
  const styles = new Map();
  const defsChildren = [];

  const defs = {
    tagName: 'defs',
    children: defsChildren,
    appendChild(child) {
      defsChildren.push(child);
      return child;
    }
  };

  const svg = {
    tagName: 'svg',
    children,
    style: {
      setProperty(name, val) { styles.set(name, val); },
      getProperty(name) { return styles.get(name); }
    },
    querySelector(selector) {
      if (selector === 'defs') return defs;
      return null;
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    ownerDocument: {
      createElementNS(ns, tag) {
        const attributes = {};
        const stopChildren = [];
        return {
          tagName: tag,
          attributes,
          children: stopChildren,
          setAttribute(k, v) { attributes[k] = String(v); },
          getAttribute(k) { return attributes[k]; },
          appendChild(c) { stopChildren.push(c); return c; }
        };
      }
    }
  };

  return { svg, defs, styles };
}

describe('setGradient', () => {
  test('creates linear gradient with angle and sets --cb-fill', () => {
    const { svg, defs, styles } = createMockSvg();
    const mockShape = { svgElement: svg };

    const grad = setGradient(mockShape, {
      type: 'linear',
      angle: 135,
      stops: ['#f43f5e', '#8b5cf6']
    });

    assert.ok(grad.id.startsWith('cb-grad-'));
    assert.equal(styles.get('--cb-fill'), `url(#${grad.id})`);

    const gradEl = defs.children[0];
    assert.equal(gradEl.tagName, 'linearGradient');
    assert.equal(gradEl.attributes.id, grad.id);
    assert.equal(gradEl.children.length, 2);
    assert.equal(gradEl.children[0].attributes['stop-color'], '#f43f5e');
    assert.equal(gradEl.children[1].attributes['stop-color'], '#8b5cf6');
  });

  test('creates radial gradient', () => {
    const { svg, defs, styles } = createMockSvg();
    const mockShape = { svgElement: svg };

    const grad = setGradient(mockShape, {
      type: 'radial',
      stops: [
        { offset: 0, color: '#38bdf8', opacity: 1 },
        { offset: 1, color: '#0369a1', opacity: 0.5 }
      ]
    });

    assert.equal(styles.get('--cb-fill'), `url(#${grad.id})`);
    const gradEl = defs.children[0];
    assert.equal(gradEl.tagName, 'radialGradient');
    assert.equal(gradEl.children.length, 2);
    assert.equal(gradEl.children[1].attributes['stop-opacity'], '0.5');
  });
});
