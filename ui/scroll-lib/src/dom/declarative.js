import { parseAttrs } from '../core/attrs.js';
import { createScroll } from './scroll.js';

/**
 * Find all [data-scroll] elements in root and init them.
 * Idempotent: already-initialized elements are skipped (createScroll returns existing).
 */
export function initScrolls(root = document) {
  const elements = root.querySelectorAll('[data-scroll]');
  const instances = [];
  for (const el of elements) {
    const attrOpts = parseAttrs(el.dataset);
    const inst = createScroll(el, {}, attrOpts);
    instances.push(inst);
  }
  return instances;
}
