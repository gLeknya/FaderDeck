import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { joinShapes } from '../../src/index.js';

function createMockDomTree() {
  const listeners = new Map();

  const container = {
    nodeType: 1,
    tagName: 'div',
    children: [],
    style: { position: 'relative' },
    attributes: {},
    scrollLeft: 0,
    scrollTop: 0,
    clientLeft: 0,
    clientTop: 0,
    parentElement: null,
    setAttribute(name, val) { this.attributes[name] = String(val); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    appendChild(child) {
      child.parentNode = container;
      this.children.push(child);
      return child;
    },
    insertBefore(newChild, refChild) {
      newChild.parentNode = container;
      const idx = this.children.indexOf(refChild);
      if (idx === -1) {
        this.children.push(newChild);
      } else {
        this.children.splice(idx, 0, newChild);
      }
      return newChild;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400 };
    }
  };

  const doc = {
    createElementNS(ns, tag) {
      const el = {
        nodeType: 1,
        tagName: tag,
        namespaceURI: ns,
        children: [],
        style: {},
        attributes: {},
        setAttribute(name, val) { this.attributes[name] = String(val); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        appendChild(child) {
          child.parentNode = el;
          this.children.push(child);
          return child;
        }
      };
      return el;
    }
  };
  container.ownerDocument = doc;

  const createChild = (left, top, width, height) => {
    const childListeners = new Map();
    const child = {
      nodeType: 1,
      tagName: 'div',
      style: { background: 'transparent' },
      attributes: {},
      parentElement: container,
      parentNode: container,
      setAttribute(name, val) { this.attributes[name] = String(val); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      getBoundingClientRect() {
        return { left, top, width, height, right: left + width, bottom: top + height };
      },
      addEventListener(type, fn) {
        if (!childListeners.has(type)) childListeners.set(type, []);
        childListeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = childListeners.get(type);
        if (list) {
          const idx = list.indexOf(fn);
          if (idx !== -1) list.splice(idx, 1);
        }
      },
      _listeners: childListeners
    };
    container.children.push(child);
    return child;
  };

  return { container, createChild };
}

describe('joinShapes', () => {
  test('unites multiple elements into single SVG layer in common ancestor', () => {
    const { container, createChild } = createMockDomTree();

    // Element A: [0, 0, 100, 100]
    const elA = createChild(0, 0, 100, 100);
    // Element B: [100, 50, 80, 50] (touching along x = 100)
    const elB = createChild(100, 50, 80, 50);

    const controller = joinShapes([elA, elB], { radius: 10, concaveRadius: 10 });

    // SVG layer should be inserted as first child of container
    assert.equal(container.children[0].tagName, 'svg');
    assert.equal(container.children[0].getAttribute('class'), 'corner-bite-layer');

    // Path should be generated
    const pathD = controller.getPath();
    assert.ok(pathD.startsWith('M '));
    // Contains concave sweep 0
    assert.ok(pathD.includes(' 0 0 0 '));

    // Idempotent destroy
    controller.destroy();
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0], elA);
    assert.equal(container.children[1], elB);

    controller.destroy();
    assert.equal(container.children.length, 2);
  });
});
