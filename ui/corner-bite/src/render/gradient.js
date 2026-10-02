const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientCounter = 0;

/**
 * Creates or updates an SVG gradient in the shape's defs and assigns it to --cb-fill.
 *
 * @param {any} shape - Controller from attach() or joinShapes()
 * @param {Object} options
 * @param {'linear' | 'radial'} [options.type='linear']
 * @param {Array<string | {offset: string | number, color: string, opacity?: number}>} options.stops
 * @param {number | string} [options.angle] - Angle in degrees (for linear)
 * @param {{x: string | number, y: string | number}} [options.from]
 * @param {{x: string | number, y: string | number}} [options.to]
 * @param {{cx?: string | number, cy?: string | number, r?: string | number}} [options.radial]
 * @returns {{ id: string, element: SVGGradientElement }}
 */
export function setGradient(shape, options) {
  if (!shape) {
    throw new TypeError('setGradient requires a valid shape controller');
  }

  const svg = shape.svgElement || (shape.container?.querySelector?.('svg.corner-bite-layer'));
  if (!svg) {
    throw new Error('Shape does not have an active SVG layer to attach a gradient');
  }

  const doc = svg.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('DOM Document is not available');
  }

  // Get or create <defs>
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, 'defs');
    if (svg.firstChild) {
      svg.insertBefore(defs, svg.firstChild);
    } else {
      svg.appendChild(defs);
    }
  }

  const id = `cb-grad-${++gradientCounter}`;
  const type = options.type || 'linear';

  let gradEl;
  if (type === 'linear') {
    gradEl = doc.createElementNS(SVG_NS, 'linearGradient');

    if (options.angle !== undefined) {
      // Convert CSS angle (0deg = up, 90deg = right, 180deg = down) to SVG vector
      const deg = typeof options.angle === 'number' ? options.angle : parseFloat(options.angle) || 0;
      const rad = (deg - 90) * (Math.PI / 180);
      const x1 = Math.round(50 + Math.cos(rad + Math.PI) * 50);
      const y1 = Math.round(50 + Math.sin(rad + Math.PI) * 50);
      const x2 = Math.round(50 + Math.cos(rad) * 50);
      const y2 = Math.round(50 + Math.sin(rad) * 50);

      gradEl.setAttribute('x1', `${x1}%`);
      gradEl.setAttribute('y1', `${y1}%`);
      gradEl.setAttribute('x2', `${x2}%`);
      gradEl.setAttribute('y2', `${y2}%`);
    } else if (options.from || options.to) {
      gradEl.setAttribute('x1', String(options.from?.x ?? '0%'));
      gradEl.setAttribute('y1', String(options.from?.y ?? '0%'));
      gradEl.setAttribute('x2', String(options.to?.x ?? '100%'));
      gradEl.setAttribute('y2', String(options.to?.y ?? '0%'));
    }
  } else {
    gradEl = doc.createElementNS(SVG_NS, 'radialGradient');
    if (options.radial) {
      if (options.radial.cx) gradEl.setAttribute('cx', String(options.radial.cx));
      if (options.radial.cy) gradEl.setAttribute('cy', String(options.radial.cy));
      if (options.radial.r) gradEl.setAttribute('r', String(options.radial.r));
    }
  }

  gradEl.setAttribute('id', id);

  // Add color stops
  const stops = options.stops || ['#38bdf8', '#818cf8'];
  const numStops = stops.length;

  for (let i = 0; i < numStops; i++) {
    const s = stops[i];
    const stopEl = doc.createElementNS(SVG_NS, 'stop');

    if (typeof s === 'string') {
      const offset = numStops === 1 ? '100%' : `${Math.round((i / (numStops - 1)) * 100)}%`;
      stopEl.setAttribute('offset', offset);
      stopEl.setAttribute('stop-color', s);
    } else {
      const offsetVal = typeof s.offset === 'number' ? `${s.offset * 100}%` : s.offset;
      stopEl.setAttribute('offset', String(offsetVal));
      stopEl.setAttribute('stop-color', s.color);
      if (s.opacity !== undefined) {
        stopEl.setAttribute('stop-opacity', String(s.opacity));
      }
    }
    gradEl.appendChild(stopEl);
  }

  defs.appendChild(gradEl);

  // Apply gradient to layer via CSS variable
  if (svg.style && typeof svg.style.setProperty === 'function') {
    svg.style.setProperty('--cb-fill', `url(#${id})`);
  }

  return { id, element: gradEl };
}
