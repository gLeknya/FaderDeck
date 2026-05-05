(function initDebugPanel(window) {
  // ── State ────────────────────────────────────────────────────────────
  const dom = {};
  let currentData = null;
  let currentSection = 'all';
  let refreshIntervalId = null;
  let autoRefreshMs = 2000;
  let updateSequence = 0;

  // ── Helpers ─────────────────────────────────────────────────────────
  function $(id) {
    return document.getElementById(id);
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatMs(ts) {
    if (!ts) return '—';
    const d = Date.now() - Number(ts);
    if (d < 0) return 'future';
    if (d < 1000) return `${d}ms ago`;
    if (d < 60000) return `${(d / 1000).toFixed(1)}s ago`;
    return `${(d / 60000).toFixed(1)}m ago`;
  }

  function ageClass(ts) {
    const d = Date.now() - Number(ts);
    if (d > 30000) return 'debug-ts-bar__dot--error';
    if (d > 5000) return 'debug-ts-bar__dot--stale';
    return '';
  }

  function classify(val) {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean') return val ? 'bool-true' : 'bool-false';
    if (typeof val === 'number') return 'num';
    return 'str';
  }

  function fmtVal(val) {
    if (val === null || val === undefined) return '<span class="debug-kv__val--null">null</span>';
    if (typeof val === 'boolean') {
      return `<span class="debug-kv__val--${val}">${val}</span>`;
    }
    if (typeof val === 'number') {
      return `<span class="debug-kv__val--num">${val}</span>`;
    }
    return `<span class="debug-kv__val--str">${escHtml(val)}</span>`;
  }

  function kv(key, value, indent) {
    const cls = indent ? ' debug-sub-row' : '';
    const vstr = value === null || value === undefined
      ? '<span class="debug-kv__val--null">null</span>'
      : fmtVal(value);
    return `<div class="debug-kv${cls}"><span class="debug-kv__key">${escHtml(key)}</span><span class="debug-kv__sep">:</span><span class="debug-kv__val">${vstr}</span></div>`;
  }

  function kvFlat(obj, indent) {
    if (!obj || typeof obj !== 'object') return kv('--', obj, indent);
    return Object.entries(obj)
      .map(([k, v]) => kv(k, v, indent))
      .join('');
  }

  function section(title, content, opts = {}) {
    const collapsed = opts.collapsed ? ' debug-section--collapsed' : '';
    const badge = opts.badge
      ? `<span class="debug-section__badge${opts.badgeOn ? ' debug-section__badge--on' : opts.badgeOff ? ' debug-section__badge--off' : ''}">${escHtml(opts.badge)}</span>`
      : '';
    const toggleBtn = opts.collapsible
      ? `<button class="debug-section__toggle" data-toggle="${escHtml(title)}">${collapsed ? '+' : '−'}</button>`
      : '';
    return `<div class="debug-section${collapsed}" data-section="${escHtml(title)}">
  <div class="debug-section__header">
    <span class="debug-section__title">${escHtml(title)}</span>${badge}${toggleBtn}
  </div>
  <div class="debug-section__content">${content}</div>
</div>`;
  }

  function divider() {
    return '<hr class="debug-divider" />';
  }

  // ── Memory section ──────────────────────────────────────────────────
  function renderMemorySection(data) {
    const mem = data?.memory || {};
    const heapUsed = fmtVal(mem.heapUsed);
    const heapTotal = fmtVal(mem.heapTotal);
    const rss = fmtVal(mem.rss);
    const heapPct = mem.heapTotal
      ? ((mem.heapUsed / mem.heapTotal) * 100).toFixed(0)
      : '?';

    return section('Memory', `
      <div class="debug-kv"><span class="debug-kv__key">rss</span><span class="debug-kv__sep">:</span><span class="debug-kv__val debug-kv__val--str">${escHtml(rss)}</span></div>
      <div class="debug-kv"><span class="debug-kv__key">heapUsed</span><span class="debug-kv__sep">:</span><span class="debug-kv__val debug-kv__val--str">${escHtml(heapUsed)}</span></div>
      <div class="debug-kv"><span class="debug-kv__key">heapTotal</span><span class="debug-kv__sep">:</span><span class="debug-kv__val debug-kv__val--str">${escHtml(heapTotal)}</span></div>
      <div class="debug-kv"><span class="debug-kv__key">heapUsage</span><span class="debug-kv__sep">:</span><span class="debug-kv__val debug-kv__val--str">${escHtml(heapPct)}%</span> <span class="debug-bar"><span class="debug-bar__fill" style="width:${escHtml(heapPct)}%"></span></span></div>
    `);
  }

  // ── App info section ─────────────────────────────────────────────────
  function renderAppSection(data) {
    const app = data?.app || {};
    const settings = data?.settings || {};
    const uptime = app.uptime ? `${(Number(app.uptime) / 1000).toFixed(0)}s` : '?';

    return section('App', `
      ${kv('version', app.version)}
      ${kv('uptime', uptime)}
      ${kv('locale', app.locale)}
      ${divider()}
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">Settings</div>
      ${kv('developerMode', settings.developerMode)}
      ${kv('advancedMode', settings.advancedMode)}
      ${kv('faderInterpolation', settings.faderInterpolationEnabled)}
      ${kv('softTakeover', settings.softTakeoverEnabled)}
      ${kv('softTakeoverThreshold', settings.softTakeoverThreshold)}
      ${kv('volumeHudEnabled', settings.volumeHudEnabled)}
      ${kv('closeToTray', settings.closeToTrayEnabled)}
      ${kv('autoUpdate', settings.autoUpdateEnabled)}
    `, { badge: settings.developerMode ? 'DEV' : null, badgeOn: settings.developerMode });
  }

  // ── Audio Apps section ───────────────────────────────────────────────
  function renderAudioAppsSection(data) {
    const apps = data?.audioApps || [];
    if (!apps.length) {
      return section('Audio Apps', '<div class="debug-empty">no apps detected</div>');
    }
    const rows = apps.map(a => `
      <tr>
        <td>${escHtml(a.name || a.process || '?')}</td>
        <td>${escHtml(a.process || '')}</td>
        <td>${fmtVal(a.volume)}%</td>
        <td>${fmtVal(a.muted)}</td>
        <td>${fmtVal(a.hasAudioSession)}</td>
      </tr>`).join('');
    return section('Audio Apps', `
      <div class="debug-ts-bar"><span class="debug-ts-bar__dot ${ageClass(data?.audioAppsAt)}"></span> ${escHtml(formatMs(data?.audioAppsAt))}</div>
      <table class="debug-table">
        <thead><tr><th>Name</th><th>Process</th><th>Vol</th><th>Mute</th><th>Session</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `, { collapsible: true, badge: String(apps.length), badgeOn: true });
  }

  // ── Channels section ────────────────────────────────────────────────
  function renderChannelsSection(data) {
    const channels = data?.channels || [];
    if (!channels.length) {
      return section('Channels', '<div class="debug-empty">no channels</div>');
    }
    const rows = channels.map(c => {
      const bindType = c.binding?.type || '—';
      const bindTarget = c.binding?.name || c.binding?.processName || c.binding?.key || '';
      const vol = typeof c.volume === 'number' ? `${c.volume.toFixed(1)}%` : '—';
      return `<tr>
        <td>${escHtml(c.name || c.id || '?')}</td>
        <td>${escHtml(bindType)}</td>
        <td>${escHtml(bindTarget)}</td>
        <td>${vol}</td>
        <td>${fmtVal(c.muted)}</td>
      </tr>`;
    }).join('');
    return section('Channels', `
      <table class="debug-table">
        <thead><tr><th>Name</th><th>Bind Type</th><th>Target</th><th>Vol</th><th>Muted</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `, { collapsible: true, badge: String(channels.length), badgeOn: true });
  }

  // ── MIDI section ─────────────────────────────────────────────────────
  function renderMidiSection(data) {
    const midi = data?.midi || {};
    const inputs = midi.inputs || [];
    const outputs = midi.outputs || [];
    const selected = midi.selectedInput || null;

    const inputRows = inputs.map(i => {
      const isActive = selected && selected.id === i.id;
      return `<tr>
        <td>${escHtml(i.name || '?')}</td>
        <td>${escHtml(i.manufacturer || '')}</td>
        <td>${escHtml(i.id || '')}</td>
        <td>${isActive ? '<span class="debug-tag debug-tag--green">active</span>' : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="debug-empty">no inputs</td></tr>';

    const outputRows = outputs.map(o => `<tr><td>${escHtml(o.name || '?')}</td><td>${escHtml(o.manufacturer || '')}</td><td>${escHtml(o.id || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="debug-empty">no outputs</td></tr>';

    return section('MIDI', `
      ${kv('supported', midi.supported)}
      ${kv('selectedInput', selected?.name || null)}
      ${kv('pickerOpen', midi.pickerOpen)}
      ${divider()}
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">Inputs</div>
      <table class="debug-table">
        <thead><tr><th>Name</th><th>Mfr</th><th>ID</th><th>State</th></tr></thead>
        <tbody>${inputRows}</tbody>
      </table>
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin:4px 0 3px">Outputs</div>
      <table class="debug-table">
        <thead><tr><th>Name</th><th>Mfr</th><th>ID</th></tr></thead>
        <tbody>${outputRows}</tbody>
      </table>
    `, { collapsible: true, badge: inputs.length ? String(inputs.length) : null, badgeOn: !!inputs.length });
  }

  // ── Runtime / Polling section ────────────────────────────────────────
  function renderRuntimeSection(data) {
    const rt = data?.runtime || {};
    return section('Runtime', `
      ${kv('audioAppsCount', rt.audioAppsCount)}
      ${kv('audioAppsRefreshing', rt.audioAppsRefreshing)}
      ${kv('lastAudioRefreshAt', formatMs(rt.lastAudioRefreshAt))}
      ${kv('channelFadersActive', rt.channelFadersActive)}
      ${kv('standaloneButtonsActive', rt.standaloneButtonsActive)}
      ${kv('focusedApp', rt.focusedApp)}
      ${kv('focusedAppAt', formatMs(rt.focusedAppAt))}
      ${divider()}
      <div class="debug-ts-bar"><span class="debug-ts-bar__dot ${ageClass(rt.lastAudioRefreshAt)}"></span> audio refresh ${escHtml(formatMs(rt.lastAudioRefreshAt))}</div>
      <div class="debug-ts-bar"><span class="debug-ts-bar__dot ${ageClass(rt.focusedAppAt)}"></span> focused app lookup ${escHtml(formatMs(rt.focusedAppAt))}</div>
    `, { collapsible: true });
  }

  // ── Audio device section ─────────────────────────────────────────────
  function renderAudioDevicesSection(data) {
    const devs = data?.audioDevices || [];
    if (!devs.length) {
      return section('Audio Devices', '<div class="debug-empty">no devices</div>');
    }
    const rows = devs.map(d => {
      const roleLabel = d.isDefault ? '<span class="debug-tag debug-tag--green">default</span>' : '';
      return `<tr>
        <td>${escHtml(d.name || '?')}</td>
        <td>${escHtml(d.flow || '')}</td>
        <td>${escHtml(String(d.volume ?? '?'))}%</td>
        <td>${fmtVal(d.muted)}</td>
        <td>${roleLabel}</td>
      </tr>`;
    }).join('');
    return section('Audio Devices', `
      <div class="debug-ts-bar"><span class="debug-ts-bar__dot ${ageClass(data?.audioDevicesAt)}"></span> ${escHtml(formatMs(data?.audioDevicesAt))}</div>
      <table class="debug-table">
        <thead><tr><th>Device</th><th>Flow</th><th>Vol</th><th>Mute</th><th>Role</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `, { collapsible: true, badge: String(devs.length), badgeOn: true });
  }

  // ── Media sessions section ───────────────────────────────────────────
  function renderMediaSection(data) {
    const sessions = data?.mediaSessions || [];
    if (!sessions.length) {
      return section('Media Sessions', '<div class="debug-empty">no active sessions</div>');
    }
    const rows = sessions.map(s => {
      const status = s.playbackState || 'unknown';
      const cls = status === 'playing' ? 'debug-tag--green' : status === 'paused' ? 'debug-tag--yellow' : 'debug-tag--red';
      return `<tr>
        <td>${escHtml(s.title || s.appId || '?')}</td>
        <td>${escHtml(s.artist || '')}</td>
        <td><span class="debug-tag ${escHtml(cls)}">${escHtml(status)}</span></td>
        <td>${fmtVal(s.repeatMode)}</td>
        <td>${fmtVal(s.isMuted)}</td>
      </tr>`;
    }).join('');
    return section('Media Sessions', `
      <table class="debug-table">
        <thead><tr><th>Title</th><th>Artist</th><th>State</th><th>Repeat</th><th>Muted</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `, { collapsible: true, badge: String(sessions.length), badgeOn: true });
  }

  // ── IPC / backend status ────────────────────────────────────────────
  function renderBackendSection(data) {
    return section('Backend Services', `
      ${kv('audioDevices', data?.audioDevices?.length ?? 0)}
      ${kv('mediaSessions', data?.mediaSessions?.length ?? 0)}
      ${kv('channelFadersActive', data?.runtime?.channelFadersActive)}
      ${kv('standaloneButtonsActive', data?.runtime?.standaloneButtonsActive)}
    `, { collapsible: true });
  }

  // ── Full state snapshot ─────────────────────────────────────────────
  function renderStateSection(data) {
    const raw = data?.rawState || {};
    return section('Full State Snapshot', `
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">ui.settings</div>
      ${kvFlat(raw.ui?.settings)}
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin:4px 0 3px">ui.session</div>
      ${kvFlat(raw.ui?.session)}
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin:4px 0 3px">channels</div>
      ${kvFlat(raw.channels)}
      <div style="font-size:9px;color:#555;letter-spacing:.06em;text-transform:uppercase;margin:4px 0 3px">runtime</div>
      ${kvFlat(raw.runtime)}
    `, { collapsible: true, collapsed: true });
  }

  // ── Refresh indicator ───────────────────────────────────────────────
  function renderRefreshBar(data) {
    const seq = data?.updateSequence ?? 0;
    const age = data?.emittedAt ? formatMs(data.emittedAt) : '—';
    return `<div class="debug-panel__header" style="cursor:default;pointer-events:none">
      <div class="debug-ts-bar">
        <span class="debug-ts-bar__dot"></span>
        last update: ${escHtml(age)} &nbsp;|&nbsp; seq: ${escHtml(String(seq))} &nbsp;|&nbsp; auto-refresh: ${escHtml(String(autoRefreshMs))}ms
      </div>
    </div>`;
  }

  // ── Main render ────────────────────────────────────────────────────
  function render(data) {
    if (!dom.body) return;
    currentData = data;

    const html = [
      renderAppSection(data),
      renderMemorySection(data),
      renderBackendSection(data),
      divider(),
      renderRuntimeSection(data),
      renderAudioAppsSection(data),
      renderAudioDevicesSection(data),
      divider(),
      renderChannelsSection(data),
      divider(),
      renderMidiSection(data),
      renderMediaSection(data),
      divider(),
      renderStateSection(data)
    ].join('\n');

    dom.body.innerHTML = html;

    // Attach collapsible toggles
    dom.body.querySelectorAll('.debug-section__toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const secEl = btn.closest('.debug-section');
        secEl?.classList.toggle('debug-section--collapsed');
        btn.textContent = secEl?.classList.contains('debug-section--collapsed') ? '+' : '−';
      });
    });
  }

  // ── Cache DOM ──────────────────────────────────────────────────────
  function cacheDom() {
    dom.root = $('debugPanel');
    dom.body = $('debugBody');
    dom.version = $('appVersion');
    dom.closeBtn = $('debugCloseBtn');
  }

  // ── IPC ────────────────────────────────────────────────────────────
  function handleDebugUpdate(payload) {
    render(payload);
  }

  function handleDebugClose() {
    dom.root?.classList.add('is-hidden');
  }

  // ── Init ───────────────────────────────────────────────────────────
  function init() {
    cacheDom();

    window.debugPanel?.onUpdate?.(handleDebugUpdate);
    window.debugPanel?.onClose?.(handleDebugClose);

    dom.closeBtn?.addEventListener('click', () => {
      window.debugPanel?.requestClose?.();
    });
  }

  window.addEventListener('DOMContentLoaded', init, { once: true });
})(window);
