import { createScroll, initScrolls, setDefaults, definePreset, getInstance } from '../src/index.js';

// ---- Global config ----
setDefaults({ visibility: 'auto', idleDelay: 900 });

// Register presets
definePreset('thin', {
  options: { minThumb: 16, visibility: 'always' },
  className: 'sb-theme-thin',
});

// ---- Color palette for horizontal items ----
const colors = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e',
  '#06b6d4', '#84cc16', '#d946ef', '#f59e0b', '#10b981',
];

// ---- Populate horizontal content ----
function fillHorizontal(containerId) {
  const container = document.querySelector(`#${containerId} .h-content`);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 20; i++) {
    const item = document.createElement('div');
    item.className = 'h-item';
    item.style.background = colors[i % colors.length];
    item.textContent = `Item ${i + 1}`;
    container.appendChild(item);
  }
}

fillHorizontal('demo-h-shift');
fillHorizontal('demo-h-always');
fillHorizontal('demo-h-auto');

// ---- 1. Vertical Scroll (imperative) ----
createScroll(document.getElementById('demo-vertical'), { axis: 'y' });

// ---- 2. Horizontal Scroll (3 modes, imperative) ----
createScroll(document.getElementById('demo-h-shift'), {
  axis: 'x',
  horizontalWheel: 'shift',
});

createScroll(document.getElementById('demo-h-always'), {
  axis: 'x',
  horizontalWheel: 'always',
});

createScroll(document.getElementById('demo-h-auto'), {
  axis: 'x',
  horizontalWheel: 'auto',
});

// ---- 3. Both Axes (imperative) ----
createScroll(document.getElementById('demo-both'), {
  axis: 'both',
  horizontalWheel: 'auto',
});

// ---- 4. External Mount (imperative) ----
createScroll(document.getElementById('demo-mount-scroll'), {
  axis: 'y',
  mount: '#mount-rail',
});

// ---- 5, 6, 8-thin, 9, 10: Declarative (data-scroll) ----
initScrolls(document);

// ---- 7. Dynamic Content (imperative) ----
const dynamicEl = document.getElementById('demo-dynamic');
const dynamicScroll = createScroll(dynamicEl, { axis: 'y' });

let itemCount = 3;
document.getElementById('btn-add').addEventListener('click', () => {
  const li = document.createElement('li');
  itemCount++;
  li.textContent = `Item ${itemCount}`;
  document.getElementById('dynamic-list').appendChild(li);
});

document.getElementById('btn-remove').addEventListener('click', () => {
  const list = document.getElementById('dynamic-list');
  if (list.lastElementChild) {
    list.removeChild(list.lastElementChild);
    itemCount = Math.max(0, itemCount - 1);
  }
});

document.getElementById('btn-resize').addEventListener('click', () => {
  dynamicEl.classList.toggle('small');
});

// ---- 8. Theme switching ----
const themeEl = document.getElementById('demo-theme');
document.getElementById('btn-theme-light').addEventListener('click', () => {
  themeEl.classList.remove('dark-theme');
  themeEl.classList.add('light-theme');
});

document.getElementById('btn-theme-dark').addEventListener('click', () => {
  themeEl.classList.remove('light-theme');
  themeEl.classList.add('dark-theme');
});

console.log('fader-scroll demo initialized ✓');
