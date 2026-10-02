import { joinShapes, calculateFillets } from '../corner-bite/src/index.js';

let cornerController = null;
let animRafId = null;

function syncCornerToMenuWidth() {
  const toolbar = document.querySelector('.toolbar');
  const menuRail = document.getElementById('menuRail');
  const contentShell = document.querySelector('.content-shell');
  if (!toolbar || !menuRail) return;

  const rect = menuRail.getBoundingClientRect();
  const W = rect.width;

  // Scale radius linearly with width:
  // When W = 0 -> r = 0 (no corner fillet)
  // When W = 72 -> r = 30 (full 30px fillet, concentric with 18px card radius + 12px gap)
  const r = Math.max(0, Math.min(30, (W / 72) * 30));

  if (cornerController) {
    cornerController.setRadius(0, r, true);
  }

  // Calculate exact border mask positions:
  // Top toolbar mask: hides toolbar bottom border from x = 0 to x = W - 0.5 + r
  // Side rail border: begins below arc at y = r - 1 (local coords of menuRail) to ensure seamless 1px overlap
  const maskWidth = r > 0.5 ? Math.max(0, W - 0.5 + r) : 0;
  const railBorderTop = r > 0.5 ? Math.max(0, r - 1) : 0;
  const cornerRadius = r > 0.5 ? r : 0;

  toolbar.style.setProperty('--toolbar-mask-width', `${maskWidth}px`);
  menuRail.style.setProperty('--rail-border-top', `${railBorderTop}px`);
  if (contentShell) {
    contentShell.style.setProperty('--corner-radius', `${cornerRadius}px`);
  }
}

export function notifyMenuTransition() {
  if (animRafId !== null) {
    cancelAnimationFrame(animRafId);
    animRafId = null;
  }

  const startTime = performance.now();
  const duration = 280; // 220ms CSS transition + buffer

  const frame = (now) => {
    syncCornerToMenuWidth();
    if (now - startTime < duration) {
      animRafId = requestAnimationFrame(frame);
    } else {
      animRafId = null;
      syncCornerToMenuWidth();
    }
  };

  animRafId = requestAnimationFrame(frame);
}

// --- Bottom Media Player Corner-Bite Integration ---
let playerResizeObserver = null;
let playerSvgObj = null;

export function syncBottomPlayerShape() {
  const shell = document.getElementById('mediaControllerShell');
  if (!shell) return;

  // Ensure SVG layer exists inside shell
  if (!playerSvgObj || !shell.contains(playerSvgObj.svg)) {
    const doc = shell.ownerDocument || document;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'corner-bite-layer media-controller-bg-layer');
    svg.setAttribute('aria-hidden', 'true');

    // Create defs with gradient matching design
    const defs = doc.createElementNS(svgNS, 'defs');
    const grad = doc.createElementNS(svgNS, 'linearGradient');
    grad.setAttribute('id', 'mediaControllerGrad');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');

    const stop1 = doc.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#242424');
    stop1.setAttribute('stop-opacity', '0.96');

    const stop2 = doc.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#1b1b1b');
    stop2.setAttribute('stop-opacity', '0.96');

    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const fillPath = doc.createElementNS(svgNS, 'path');
    fillPath.setAttribute('class', 'media-controller-bg-fill');
    fillPath.setAttribute('fill', 'url(#mediaControllerGrad)');
    svg.appendChild(fillPath);

    const strokePath = doc.createElementNS(svgNS, 'path');
    strokePath.setAttribute('class', 'media-controller-bg-stroke');
    svg.appendChild(strokePath);

    if (shell.firstChild) {
      shell.insertBefore(svg, shell.firstChild);
    } else {
      shell.appendChild(svg);
    }

    playerSvgObj = { svg, fillPath, strokePath };
  }

  const rect = shell.getBoundingClientRect();
  const W = Math.round(rect.width);
  if (W <= 0) return;

  const computed = window.getComputedStyle(shell);
  const H = parseFloat(computed.getPropertyValue('--media-controller-shape-height')) || 44;
  const R_conv = parseFloat(computed.getPropertyValue('--media-controller-radius')) || 16;
  const R_conc = parseFloat(computed.getPropertyValue('--media-controller-concave-radius')) || 16;
  const T = parseFloat(computed.getPropertyValue('--media-controller-tail-width')) || R_conc;
  const totalW = W + 2 * T;

  const strokeInset = 0.5;
  const yTop = strokeInset;
  const yBottom = H - strokeInset;
  const xLeft = strokeInset;
  const xRight = totalW - strokeInset;

  // 1. Uninset geometry for fill (covers full [0..totalW] x [0..H])
  const fillVertices = [
    { x: T, y: 0, r: R_conv },
    { x: T + W, y: 0, r: R_conv },
    { x: T + W, y: H, r: R_conc },
    { x: totalW, y: H, r: 0 },
    { x: totalW, y: H + 10, r: 0 },
    { x: 0, y: H + 10, r: 0 },
    { x: 0, y: H, r: 0 },
    { x: T, y: H, r: R_conc }
  ];
  const fillFillets = calculateFillets(fillVertices, { radius: R_conv, concaveRadius: R_conc });
  if (fillFillets.length < 8) return;
  const ff7 = fillFillets[7], ff0 = fillFillets[0], ff1 = fillFillets[1], ff2 = fillFillets[2];

  // 2. Inset geometry for stroke (fits crisply within [0.5..totalW-0.5] x [0.5..H-0.5])
  const strokeVertices = [
    { x: T, y: yTop, r: R_conv },
    { x: T + W, y: yTop, r: R_conv },
    { x: T + W, y: yBottom, r: R_conc },
    { x: xRight, y: yBottom, r: 0 },
    { x: xRight, y: H + 10, r: 0 },
    { x: xLeft, y: H + 10, r: 0 },
    { x: xLeft, y: yBottom, r: 0 },
    { x: T, y: yBottom, r: R_conc }
  ];
  const strokeFillets = calculateFillets(strokeVertices, { radius: R_conv, concaveRadius: R_conc });
  if (strokeFillets.length < 8) return;
  const sf7 = strokeFillets[7], sf0 = strokeFillets[0], sf1 = strokeFillets[1], sf2 = strokeFillets[2];

  const fmt = (n) => Number(n.toFixed(2)).toString();

  const strokeD = [
    `M ${fmt(sf7.pStart.x)} ${fmt(sf7.pStart.y)}`,
    `A ${fmt(sf7.r)} ${fmt(sf7.r)} 0 0 ${sf7.sweep} ${fmt(sf7.pEnd.x)} ${fmt(sf7.pEnd.y)}`,
    `L ${fmt(sf0.pStart.x)} ${fmt(sf0.pStart.y)}`,
    `A ${fmt(sf0.r)} ${fmt(sf0.r)} 0 0 ${sf0.sweep} ${fmt(sf0.pEnd.x)} ${fmt(sf0.pEnd.y)}`,
    `L ${fmt(sf1.pStart.x)} ${fmt(sf1.pStart.y)}`,
    `A ${fmt(sf1.r)} ${fmt(sf1.r)} 0 0 ${sf1.sweep} ${fmt(sf1.pEnd.x)} ${fmt(sf1.pEnd.y)}`,
    `L ${fmt(sf2.pStart.x)} ${fmt(sf2.pStart.y)}`,
    `A ${fmt(sf2.r)} ${fmt(sf2.r)} 0 0 ${sf2.sweep} ${fmt(sf2.pEnd.x)} ${fmt(sf2.pEnd.y)}`
  ].join(' ');

  const fillD = [
    `M ${fmt(ff7.pStart.x)} ${fmt(ff7.pStart.y)}`,
    `A ${fmt(ff7.r)} ${fmt(ff7.r)} 0 0 ${ff7.sweep} ${fmt(ff7.pEnd.x)} ${fmt(ff7.pEnd.y)}`,
    `L ${fmt(ff0.pStart.x)} ${fmt(ff0.pStart.y)}`,
    `A ${fmt(ff0.r)} ${fmt(ff0.r)} 0 0 ${ff0.sweep} ${fmt(ff0.pEnd.x)} ${fmt(ff0.pEnd.y)}`,
    `L ${fmt(ff1.pStart.x)} ${fmt(ff1.pStart.y)}`,
    `A ${fmt(ff1.r)} ${fmt(ff1.r)} 0 0 ${ff1.sweep} ${fmt(ff1.pEnd.x)} ${fmt(ff1.pEnd.y)}`,
    `L ${fmt(ff2.pStart.x)} ${fmt(ff2.pStart.y)}`,
    `A ${fmt(ff2.r)} ${fmt(ff2.r)} 0 0 ${ff2.sweep} ${fmt(ff2.pEnd.x)} ${fmt(ff2.pEnd.y)}`,
    `L ${fmt(ff7.pStart.x)} ${fmt(H)} Z`
  ].join(' ');

  playerSvgObj.svg.setAttribute('viewBox', `0 0 ${totalW} ${H}`);
  playerSvgObj.svg.style.width = `${totalW}px`;
  playerSvgObj.svg.style.height = `${H}px`;
  playerSvgObj.svg.style.left = `-${T}px`;
  playerSvgObj.fillPath.setAttribute('d', fillD);
  playerSvgObj.strokePath.setAttribute('d', strokeD);
}

export function initBottomPlayerCornerBite() {
  const shell = document.getElementById('mediaControllerShell');
  if (shell) {
    if (!playerResizeObserver) {
      playerResizeObserver = new ResizeObserver(() => {
        syncBottomPlayerShape();
      });
      playerResizeObserver.observe(shell);
    }
    syncBottomPlayerShape();
  } else {
    // If shell not yet in DOM, observe document body for its addition
    const observer = new MutationObserver(() => {
      const s = document.getElementById('mediaControllerShell');
      if (s) {
        observer.disconnect();
        initBottomPlayerCornerBite();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export function initCornerBite() {
  const toolbar = document.querySelector('.toolbar');
  const menuRail = document.getElementById('menuRail');
  if (!toolbar || !menuRail) return null;

  if (cornerController) {
    cornerController.destroy();
    cornerController = null;
  }

  // zIndex: 35 places SVG overlay in front of .toolbar (z-index: 30) so .toolbar::after
  // does not chop off the top of the arc stroke.
  // patchStrokeExtension: 0.75 adds a 0.75px tangential lead-in/out to prevent subpixel gaps.
  cornerController = joinShapes([toolbar, menuRail], {
    radius: 0,
    concaveRadius: 0,
    mode: 'patches',
    patchColor: '#202020',
    patchStroke: 'rgba(255, 255, 255, 0.1)',
    patchStrokeWidth: '1.0px',
    patchStrokeInset: 0.5,
    patchStrokeExtension: 0.75,
    patchStrokeLinecap: 'round',
    follow: false,
    zIndex: 35
  });

  // Listen to menuRail transition events
  menuRail.addEventListener('transitionrun', (e) => {
    if (e.propertyName === 'width') notifyMenuTransition();
  });
  menuRail.addEventListener('transitionstart', (e) => {
    if (e.propertyName === 'width') notifyMenuTransition();
  });
  menuRail.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width') {
      if (animRafId !== null) {
        cancelAnimationFrame(animRafId);
        animRafId = null;
      }
      syncCornerToMenuWidth();
    }
  });

  window.addEventListener('resize', () => {
    syncCornerToMenuWidth();
    syncBottomPlayerShape();
  }, { passive: true });

  window.__cornerBiteController = cornerController;
  window.__cornerBiteBridge = {
    notifyMenuTransition,
    syncCornerToMenuWidth,
    syncBottomPlayerShape,
    initBottomPlayerCornerBite
  };

  // Initial syncs
  syncCornerToMenuWidth();
  initBottomPlayerCornerBite();

  return cornerController;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initCornerBite();
  });
} else {
  initCornerBite();
}
