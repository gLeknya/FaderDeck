/*!
 * FDDropdown — dropdown, который плавно раскрывается, а выбранный пункт «переезжает»
 * между шапкой и своим местом в списке. Без зависимостей, CSS подключается сам.
 *
 *   const dd = new FDDropdown('#box', {
 *     items: ['Turn off', 'SMC-Mixer', { label: 'MIDIIN2', value: 'midi2' }],
 *     index: 1,                       // или value: 'SMC-Mixer'; -1 = ничего не выбрано
 *     placeholder: 'Choose…',
 *     direction: 'down',              // 'down' | 'up' | 'auto' (сам выбирает, где больше места)
 *     onChange(value, d) { console.log(value, d.index, d.item); }
 *   });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FDDropdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CSS = [
    '.fdd{--fdd-bg:#232323;--fdd-border:#343434;--fdd-hover:#2e2e2e;--fdd-active:#393939;--fdd-text:#e6e6e6;--fdd-muted:#8c8c8c;',
    '--fdd-radius:12px;--fdd-item-radius:8px;--fdd-head:38px;--fdd-item-h:32px;--fdd-gap:2px;--fdd-pad:6px;',
    '--fdd-dur:.55s;--fdd-ease:cubic-bezier(.22,1,.36,1);--fdd-n:0;--fdd-step:calc(var(--fdd-item-h) + var(--fdd-gap));',
    'position:relative;width:100%;height:calc(var(--fdd-head) + 2px);box-sizing:border-box;color:var(--fdd-text);',
    'font:14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}',
    '.fdd *,.fdd *::before,.fdd *::after{box-sizing:border-box}',

    '.fdd-card{position:absolute;left:0;right:0;top:0;height:calc(var(--fdd-head) + 2px);overflow:hidden;',
    'background:var(--fdd-bg);border:1px solid var(--fdd-border);border-radius:var(--fdd-radius);',
    'transition:height var(--fdd-dur) var(--fdd-ease),box-shadow var(--fdd-dur) var(--fdd-ease)}',
    '.fdd.fdd-raise .fdd-card{z-index:10}',
    '.fdd.fdd-open .fdd-card{box-shadow:0 14px 34px rgba(0,0,0,.45);',
    'height:max(calc(var(--fdd-head) + 2px),calc(var(--fdd-n)*var(--fdd-item-h) + (var(--fdd-n) - 1)*var(--fdd-gap) + 2*var(--fdd-pad) + 2px))}',

    '.fdd-list{position:absolute;inset:0;margin:0;padding:0;list-style:none}',
    '.fdd-item{--d:var(--i);--slot:calc(var(--fdd-pad) + var(--i)*var(--fdd-step));position:absolute;left:var(--fdd-pad);right:var(--fdd-pad);top:0;',
    'height:var(--fdd-item-h);line-height:var(--fdd-item-h);padding:0 32px 0 8px;border-radius:var(--fdd-item-radius);',
    'color:var(--fdd-muted);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;',
    'opacity:0;transform:translateY(calc(var(--slot) - 8px));',
    'transition:transform var(--fdd-dur) var(--fdd-ease),opacity .2s ease,background-color .35s ease,color .25s ease}',
    '.fdd-item.fdd-sel{opacity:1;z-index:2;color:var(--fdd-text);transform:translateY(calc((var(--fdd-head) - var(--fdd-item-h))/2))}',

    '.fdd-open .fdd-item{pointer-events:auto;opacity:1;transform:translateY(var(--slot))}',
    '.fdd-open .fdd-item:not(.fdd-sel){transition-delay:calc(min(var(--d)*35ms,280ms) + 90ms),calc(min(var(--d)*35ms,280ms) + 90ms),0s,0s}',
    '.fdd-open .fdd-item.fdd-sel{background:var(--fdd-active)}',
    '.fdd-open .fdd-item:not(.fdd-sel):not(.fdd-dis):hover,.fdd-item.fdd-kbd:not(.fdd-sel):not(.fdd-dis){background:var(--fdd-hover);color:var(--fdd-text)}',
    '.fdd-open .fdd-item.fdd-dis{opacity:.4;cursor:not-allowed}',

    '.fdd-ph{position:absolute;left:14px;right:34px;top:0;height:var(--fdd-head);line-height:var(--fdd-head);color:var(--fdd-muted);',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;opacity:0;transition:opacity .25s ease}',
    '.fdd-empty:not(.fdd-open) .fdd-ph{opacity:1}',

    '.fdd-head{all:unset;box-sizing:border-box;position:absolute;left:0;right:0;top:0;height:var(--fdd-head);cursor:pointer;z-index:5}',
    '.fdd-open .fdd-head{left:auto;width:40px}',
    '.fdd-head:focus-visible{outline:2px solid #6aa7ff;outline-offset:-2px;border-radius:calc(var(--fdd-radius) - 1px)}',
    '.fdd-chev{position:absolute;z-index:6;right:12px;top:calc((var(--fdd-head) - 16px)/2);width:16px;height:16px;',
    'color:var(--fdd-muted);pointer-events:none;transition:transform var(--fdd-dur) var(--fdd-ease),color .3s ease}',
    '.fdd-open .fdd-chev{transform:rotate(180deg);color:var(--fdd-text)}',

    '.fdd-probe{position:absolute;left:0;top:0;width:var(--fdd-pad);height:var(--fdd-gap);visibility:hidden;pointer-events:none}',
    '.fdd-nt .fdd-card,.fdd-nt .fdd-item,.fdd-nt .fdd-chev{transition:none!important}',

    /* ---- раскрытие вверх: всё привязано к низу, карточка растёт вверх ---- */
    '.fdd-dir-up .fdd-card{top:auto;bottom:0}',
    '.fdd-dir-up.fdd-open .fdd-card{box-shadow:0 -14px 34px rgba(0,0,0,.45)}',
    '.fdd-dir-up .fdd-head,.fdd-dir-up .fdd-ph{top:auto;bottom:0}',
    '.fdd-dir-up .fdd-chev{top:auto;bottom:calc((var(--fdd-head) - 16px)/2);transform:rotate(180deg)}',
    '.fdd-dir-up.fdd-open .fdd-chev{transform:none}',
    '.fdd-dir-up .fdd-item{--d:calc(var(--fdd-n) - 1 - var(--i));',
    '--slot:calc(-1*(var(--fdd-pad) + (var(--fdd-n) - 1 - var(--i))*var(--fdd-step)));',
    'top:auto;bottom:0;transform:translateY(calc(var(--slot) + 8px))}',
    '.fdd-dir-up .fdd-item.fdd-sel{transform:translateY(calc(-1*(var(--fdd-head) - var(--fdd-item-h))/2))}',
    '.fdd-dir-up.fdd-open .fdd-item{transform:translateY(var(--slot))}',

    '@media (prefers-reduced-motion:reduce){.fdd{--fdd-dur:.01s}.fdd-open .fdd-item:not(.fdd-sel){transition-delay:0s}}'
  ].join('');

  var OPEN = [];            // открытые сейчас (одновременно открыт только один)
  var UP_MS = 700;          // сколько держать z-index после закрытия

  function injectCSS() {
    if (document.getElementById('fdd-styles')) return;
    var s = document.createElement('style');
    s.id = 'fdd-styles'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function norm(it) {
    if (it === null || typeof it !== 'object') return { value: it, label: String(it), disabled: false };
    var label = it.label !== undefined ? it.label : it.value;
    return { value: it.value !== undefined ? it.value : label, label: String(label), disabled: !!it.disabled, data: it.data };
  }

  function FDDropdown(host, opts) {
    if (typeof host === 'string') host = document.querySelector(host);
    if (!host) throw new Error('FDDropdown: container not found');
    injectCSS();
    opts = opts || {};
    this.host = host; this.opts = opts;
    this._h = {}; this._items = []; this._els = []; this._index = -1; this._kbd = -1;

    var root = this.root = document.createElement('div');
    root.className = 'fdd';
    root.innerHTML =
      '<div class="fdd-card">' +
        '<ul class="fdd-list" role="listbox"></ul>' +
        '<span class="fdd-ph"></span>' +
        '<i class="fdd-probe"></i>' +
        '<button class="fdd-head" type="button" aria-haspopup="listbox" aria-expanded="false"></button>' +
        '<svg class="fdd-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>' +
      '</div>';
    this.list = root.querySelector('.fdd-list');
    this.head = root.querySelector('.fdd-head');
    this.ph = root.querySelector('.fdd-ph');
    this.probe = root.querySelector('.fdd-probe');
    this.ph.textContent = opts.placeholder || 'Select…';
    if (opts.width !== undefined) root.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
    if (opts.className) root.className += ' ' + opts.className;
    this._dirOpt = opts.direction || 'down';
    this._setDir(this._dirOpt === 'up' ? 'up' : 'down');
    host.appendChild(root);

    var self = this;
    this._onHead = function () { self.toggle(); };
    this._onList = function (e) {
      var li = e.target.closest('.fdd-item');
      if (li && self.isOpen) self._pick(+li.dataset.i);
    };
    this._onKey = function (e) { self._key(e); };
    this._onKeyUp = function (e) { if (e.key === ' ' && self._space) { e.preventDefault(); self._space = false; } };
    this._onDoc = function (e) { if (!root.contains(e.target)) self.close(); };
    this.head.addEventListener('click', this._onHead);
    this.list.addEventListener('click', this._onList);
    root.addEventListener('keydown', this._onKey);
    root.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerdown', this._onDoc);

    this.setItems(opts.items || [], { index: opts.index, value: opts.value });
  }

  var P = FDDropdown.prototype;

  /* ---------- данные ---------- */
  P.setItems = function (items, o) {
    o = o || {};
    this.close();
    this._items = (items || []).map(norm);
    this.list.innerHTML = '';
    var self = this, n = this._items.length;
    this._els = this._items.map(function (it, i) {
      var li = document.createElement('li');
      li.className = 'fdd-item' + (it.disabled ? ' fdd-dis' : '');
      li.setAttribute('role', 'option');
      if (it.disabled) li.setAttribute('aria-disabled', 'true');
      li.dataset.i = i; li.style.setProperty('--i', i);
      li.textContent = it.label;
      self.list.appendChild(li);
      return li;
    });
    this.root.style.setProperty('--fdd-n', n);
    var idx;
    if (o.value !== undefined) idx = this._find(o.value);
    else if (typeof o.index === 'number') idx = o.index;
    else idx = n ? 0 : -1;
    this._setIndex(idx);
    return this;
  };

  P._find = function (v) {
    for (var i = 0; i < this._items.length; i++) if (this._items[i].value === v) return i;
    return -1;
  };

  P._setIndex = function (i) {
    if (i < 0 || i >= this._items.length) i = -1;
    this._index = i;
    this._els.forEach(function (el, k) {
      el.classList.toggle('fdd-sel', k === i);
      el.setAttribute('aria-selected', k === i);
    });
    this.root.classList.toggle('fdd-empty', i === -1);
    this.head.setAttribute('aria-label', i === -1 ? this.ph.textContent : this._items[i].label);
  };

  P.select = function (i, o) {         // программный выбор по индексу
    var it = this._items[i];
    if (it && it.disabled) return this;
    var changed = i !== this._index;
    this._setIndex(i);
    if (changed && !(o && o.silent)) this._emit('change');
    return this;
  };
  P.setValue = function (v, o) { return this.select(this._find(v), o); };

  /* ---------- открыть / закрыть ---------- */
  P.open = function () {
    if (this.isOpen || !this._items.length) return this;
    OPEN.slice().forEach(function (d) { d.close(); });
    OPEN.push(this);
    clearTimeout(this._t);
    this._resolveDir();
    this.root.classList.add('fdd-raise', 'fdd-open');
    this.head.setAttribute('aria-expanded', 'true');
    this._kbd = this._index; this._mark();
    this._emit('open');
    return this;
  };
  /* ---------- направление ---------- */
  P._setDir = function (dir) {
    if (this._dir === dir) return;
    var r = this.root;
    r.classList.add('fdd-nt');                 // переключаем без анимации, чтобы не было прыжка
    r.classList.toggle('fdd-dir-up', dir === 'up');
    void r.offsetWidth;                        // фиксируем стили до включения transition
    r.classList.remove('fdd-nt');
    this._dir = dir;
  };
  P._resolveDir = function () {
    if (this._dirOpt !== 'auto') return this._setDir(this._dirOpt === 'up' ? 'up' : 'down');
    var n = this._items.length, el = this._els[0];
    var need = n * el.offsetHeight + (n - 1) * this.probe.offsetHeight + 2 * this.probe.offsetWidth + 2;
    var rect = this.root.getBoundingClientRect();
    var below = window.innerHeight - rect.top, above = rect.bottom;
    this._setDir(need > below && above > below ? 'up' : 'down');
  };
  P.setDirection = function (dir) {          // 'down' | 'up' | 'auto'
    this._dirOpt = dir;
    if (!this.isOpen) this._resolveDir();
    return this;
  };

  P.close = function () {
    if (!this.isOpen) return this;
    var self = this;
    this.root.classList.remove('fdd-open');
    this.head.setAttribute('aria-expanded', 'false');
    this._kbd = -1; this._mark();
    OPEN.splice(OPEN.indexOf(this), 1);
    this._t = setTimeout(function () { self.root.classList.remove('fdd-raise'); }, UP_MS);
    this._emit('close');
    return this;
  };
  P.toggle = function () { return this.isOpen ? this.close() : this.open(); };

  P._pick = function (i) {
    var it = this._items[i];
    if (!it || it.disabled) return;
    this.select(i);
    this.close();
    this.head.focus({ preventScroll: true });
  };

  /* ---------- клавиатура ---------- */
  P._mark = function () {
    var k = this._kbd;
    this._els.forEach(function (el, i) { el.classList.toggle('fdd-kbd', i === k); });
  };
  P._move = function (from, dir) {
    var n = this._items.length;
    for (var s = 0, i = from; s < n; s++) {
      i = (i + dir + n) % n;
      if (!this._items[i].disabled) return i;
    }
    return from;
  };
  P._key = function (e) {
    var k = e.key;
    if (!this.isOpen) {
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); this.open(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); this.close(); this.head.focus(); }
    else if (k === 'Tab') this.close();
    else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); this._kbd = this._move(this._kbd, k === 'ArrowDown' ? 1 : -1); this._mark();
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      this._kbd = this._move(k === 'Home' ? -1 : this._items.length, k === 'Home' ? 1 : -1); this._mark();
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault(); this._space = k === ' ';
      if (this._kbd > -1) this._pick(this._kbd); else this.close();
    }
  };

  /* ---------- события ---------- */
  P.on = function (type, fn) { (this._h[type] = this._h[type] || []).push(fn); return this; };
  P.off = function (type, fn) {
    var a = this._h[type] || [];
    var i = a.indexOf(fn); if (i > -1) a.splice(i, 1);
    return this;
  };
  P._emit = function (type) {
    var d = { index: this._index, item: this.item, value: this.value, dropdown: this };
    (this._h[type] || []).slice().forEach(function (fn) { fn.call(d.dropdown, d.value, d); });
    var cb = this.opts['on' + type.charAt(0).toUpperCase() + type.slice(1)];
    if (typeof cb === 'function') cb.call(this, d.value, d);
    this.root.dispatchEvent(new CustomEvent('fdd:' + type, { detail: d, bubbles: true }));
  };

  P.destroy = function () {
    this.close();
    clearTimeout(this._t);
    document.removeEventListener('pointerdown', this._onDoc);
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  Object.defineProperties(P, {
    isOpen: { get: function () { return this.root.classList.contains('fdd-open'); } },
    index:  { get: function () { return this._index; } },
    item:   { get: function () { return this._items[this._index] || null; } },
    value:  { get: function () { var it = this._items[this._index]; return it ? it.value : null; } }
  });

  /* ---------- автосборка из HTML ----------
     <div data-fdd data-items="Turn off|SMC-Mixer|MIDIIN2" data-index="1" data-direction="up"></div>
     data-items может быть и JSON-массивом. */
  FDDropdown.auto = function (scope) {
    return Array.prototype.map.call((scope || document).querySelectorAll('[data-fdd]'), function (el) {
      var raw = el.dataset.items || '', items;
      try { items = raw.charAt(0) === '[' ? JSON.parse(raw) : raw.split('|').filter(Boolean); } catch (e) { items = []; }
      return new FDDropdown(el, {
        items: items,
        index: el.dataset.index !== undefined ? +el.dataset.index : undefined,
        placeholder: el.dataset.placeholder,
        direction: el.dataset.direction
      });
    });
  };

  FDDropdown.default = FDDropdown;
  return FDDropdown;
});
