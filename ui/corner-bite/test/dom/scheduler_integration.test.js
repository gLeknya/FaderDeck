import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attach, joinShapes, sharedScheduler } from '../../src/index.js';

function createMockDomTree() {
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
        appendChild(c) {
          c.parentNode = el;
          this.children.push(c);
          return c;
        },
        removeChild(c) {
          const idx = this.children.indexOf(c);
          if (idx !== -1) {
            this.children.splice(idx, 1);
            c.parentNode = null;
          }
          return c;
        }
      };
      return el;
    }
  };

  const container = {
    nodeType: 1,
    tagName: 'div',
    ownerDocument: doc,
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

  function createChild(rect) {
    const listeners = {};
    const child = {
      nodeType: 1,
      tagName: 'div',
      ownerDocument: doc,
      parentNode: container,
      parentElement: container,
      children: [],
      style: {},
      attributes: {},
      addEventListener(evt, fn) {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      removeEventListener(evt, fn) {
        if (listeners[evt]) {
          listeners[evt] = listeners[evt].filter(f => f !== fn);
        }
      },
      dispatchEvent(evt) {
        const fns = listeners[evt.type || evt] || [];
        fns.forEach(f => f(evt));
      },
      getBoundingClientRect() {
        return {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          right: rect.x + rect.w,
          bottom: rect.y + rect.h
        };
      },
      setAttribute(name, val) { this.attributes[name] = String(val); },
      getAttribute(name) { return this.attributes[name] ?? null; }
    };
    container.children.push(child);
    return child;
  }

  return { container, createChild, doc };
}

describe('Scheduler and pixelSnap integration in attach and joinShapes', () => {
  test('joinShapes schedules asynchronous updates via sharedScheduler and triggers snap after idle', () => {
    const { container, createChild } = createMockDomTree();
    const child1 = createChild({ x: 20, y: 20, w: 100, h: 50 });
    const child2 = createChild({ x: 100, y: 40, w: 80, h: 60 });

    const controller = joinShapes([child1, child2], {
      snap: true,
      mode: 'svg'
    });

    assert.ok(controller);
    assert.strictEqual(sharedScheduler.pendingCount, 0, 'Initial render is synchronous');

    // Call update: must be scheduled through sharedScheduler
    controller.update();
    controller.update();

    assert.ok(sharedScheduler.pendingCount >= 1, 'Subsequent updates should be scheduled in sharedScheduler');

    sharedScheduler.flushSync();
    assert.strictEqual(sharedScheduler.pendingCount, 0);

    controller.destroy();
  });

  test('attach schedules updates via sharedScheduler and executes snap', () => {
    const { container } = createMockDomTree();
    const rects = [{ x: 10.4, y: 10.6, w: 100.2, h: 50.8 }];

    const controller = attach(container, {
      rects,
      snap: true,
      mode: 'svg'
    });

    assert.ok(controller);
    assert.strictEqual(sharedScheduler.pendingCount, 0, 'Initial render is synchronous');

    controller.update([{ x: 15.3, y: 15.7, w: 100, h: 50 }]);
    assert.ok(sharedScheduler.pendingCount >= 1, 'attach.update should schedule via sharedScheduler');

    sharedScheduler.flushSync();
    assert.strictEqual(sharedScheduler.pendingCount, 0);

    controller.destroy();
  });
});
