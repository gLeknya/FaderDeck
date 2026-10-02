const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an SVG layer with a child path for corner-bite rendering.
 *
 * @param {Document} [doc=document]
 * @returns {{
 *   svg: SVGSVGElement,
 *   path: SVGPathElement,
 *   defs: SVGDefsElement | null
 * }}
 */
export function createSvgLayer(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) {
    throw new Error('DOM Document is not available');
  }

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'corner-bite-layer');
  svg.setAttribute('aria-hidden', 'true');

  // Absolute positioning covering host element
  Object.assign(svg.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible',
    shapeRendering: 'geometricPrecision',
  });

  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', 'corner-bite-path');

  // Default styles referencing CSS variables
  Object.assign(path.style, {
    fill: 'var(--cb-fill, currentColor)',
    stroke: 'var(--cb-stroke, none)',
    strokeWidth: 'var(--cb-stroke-width, 0)',
  });

  svg.appendChild(path);

  return { svg, path, defs: null };
}

/**
 * Updates the 'd' attribute of the path in the SVG layer.
 * @param {SVGPathElement} path
 * @param {string} d
 */
export function setPathD(path, d) {
  if (path) {
    path.setAttribute('d', d);
  }
}
