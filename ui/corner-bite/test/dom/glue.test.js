import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { glue } from '../../src/index.js';

function createMockContainer() {
  const children = [];
  const attributes = {};

  const container = {
    nodeType: 1,
    tagName: 'div',
    children,
    attributes,
    style: { position: 'relative' },
    ownerDocument: {
      createElementNS(ns, tag) {
        return {
          nodeType: 1,
          tagName: tag,
          children: [],
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = String(v); },
          getAttribute(k) { return this.attributes[k]; },
          appendChild(c) { this.children.push(c); return c; }
        };
      }
    },
    setAttribute(k, v) { attributes[k] = String(v); },
    getAttribute(k) { return attributes[k] ?? null; },
    appendChild(c) {
      c.parentNode = container;
      c.parentElement = container;
      children.push(c);
      return c;
    },
    insertBefore(c, ref) {
      c.parentNode = container;
      c.parentElement = container;
      const idx = children.indexOf(ref);
      if (idx === -1) children.push(c);
      else children.splice(idx, 0, c);
      return c;
    },
    removeChild(c) {
      const idx = children.indexOf(c);
      if (idx !== -1) {
        children.splice(idx, 1);
        c.parentNode = null;
      }
      return c;
    },
    get firstChild() { return children[0] || null; },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 400, height: 400 };
    },
    querySelectorAll(selector) {
      if (selector === '[data-concave-part]') {
        return children.filter(c => c.attributes && 'data-concave-part' in c.attributes);
      }
      return [];
    }
  };

  const createPart = (left, top, width, height) => {
    const part = {
      nodeType: 1,
      tagName: 'div',
      parentElement: container,
      parentNode: container,
      attributes: { 'data-concave-part': '' },
      style: { background: 'transparent' },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      getBoundingClientRect() {
        return { left, top, width, height };
      }
    };
    container.children.push(part);
    return part;
  };

  return { container, createPart };
}

describe('glue', () => {
  test('discovers data-concave-part elements and joins them', () => {
    const { container, createPart } = createMockContainer();
    createPart(0, 0, 100, 100);
    createPart(100, 50, 80, 50);

    const g = glue(container, { radius: 12 });
    assert.equal(g.elements.length, 2);
    assert.ok(g.getPath().startsWith('M '));

    // Refresh when dynamic children added
    createPart(180, 50, 40, 50);
    g.refresh();
    assert.equal(g.elements.length, 3);

    g.destroy();
    assert.equal(g.elements.length, 0);
  });
});
