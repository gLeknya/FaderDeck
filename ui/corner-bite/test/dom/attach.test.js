import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attach, createSvgLayer } from '../../src/index.js';

// Minimal mock DOM element
function createMockElement(tagName = 'div') {
  const children = [];
  const attributes = {};
  const style = {};

  const el = {
    nodeType: 1,
    tagName,
    children,
    attributes,
    style,
    ownerDocument: null,
    setAttribute(name, val) {
      attributes[name] = String(val);
    },
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    insertBefore(newChild, refChild) {
      newChild.parentNode = el;
      const idx = children.indexOf(refChild);
      if (idx === -1) {
        children.push(newChild);
      } else {
        children.splice(idx, 0, newChild);
      }
      return newChild;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    get firstChild() {
      return children[0] || null;
    }
  };
  return el;
}

function createMockDocument() {
  return {
    createElementNS(ns, tag) {
      const el = createMockElement(tag);
      el.namespaceURI = ns;
      return el;
    }
  };
}

describe('attach', () => {
  test('rejects non-element input', () => {
    assert.throws(() => attach(null), /valid DOM element/);
    assert.throws(() => attach({}), /valid DOM element/);
  });

  test('creates and inserts SVG layer as first child in svg mode', () => {
    const mockDoc = createMockDocument();
    const container = createMockElement('div');
    container.ownerDocument = mockDoc;

    const existingChild = createMockElement('span');
    container.appendChild(existingChild);

    const rects = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 50, y: 50, w: 100, h: 50 }
    ];

    const controller = attach(container, { rects, radius: 10, mode: 'svg' });

    assert.equal(container.children.length, 2);
    // SVG layer inserted as firstChild (under content)
    assert.equal(container.children[0].tagName, 'svg');
    assert.equal(container.children[0].getAttribute('class'), 'corner-bite-layer');
    assert.equal(container.children[1], existingChild);

    // Path element has valid d attribute
    const svgEl = container.children[0];
    const pathEl = svgEl.children[0];
    assert.equal(pathEl.tagName, 'path');
    assert.ok(pathEl.getAttribute('d').startsWith('M '));
    assert.equal(controller.getPath(), pathEl.getAttribute('d'));

    // Update geometry
    controller.update([{ x: 0, y: 0, w: 200, h: 100 }]);
    assert.ok(controller.getPath().includes('Z'));

    // destroy is idempotent and removes SVG layer
    controller.destroy();
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0], existingChild);

    // Calling destroy again should not throw
    controller.destroy();
    assert.equal(container.children.length, 1);
  });

  test('clip mode applies clip-path directly to element', () => {
    const container = createMockElement('div');
    const rects = [{ x: 0, y: 0, w: 100, h: 100 }];

    const controller = attach(container, { rects, radius: 5, mode: 'clip' });
    assert.ok(container.style.clipPath.startsWith("path('M "));

    controller.destroy();
    assert.equal(container.style.clipPath, '');
  });
});
