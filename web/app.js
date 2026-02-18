let channels = [];
let standaloneButtonsList = [];
let audioApps = [];
let currentButtonConfig = null;
let contextTarget = null;
let advancedMode = false;

const TOAST_TYPES = {
    success: { icon: '✅', baseClass: 'toast-success' },
    error:   { icon: '❌', baseClass: 'toast-error' },
    warn:    { icon: '⚠️', baseClass: 'toast-warn' },
    pending: { icon: '⏳', baseClass: 'toast-pending' }
};

let activePendingId = null;

// ---------- Logs ----------

function logTest(...args) {
    console.log('[TEST]', ...args);
}

// ---------- Toasts ----------

function showToast(type, text, options = {}) {
    const container = document.getElementById('toastContainer');
    const cfg = TOAST_TYPES[type] || TOAST_TYPES.success;
    const id = options.id || ('toast_' + Date.now());

    const defaultTimeout = type === 'pending' ? 0 : 1500;
    const timeout = typeof options.timeout === 'number'
        ? options.timeout
        : defaultTimeout;

    // обновление активного pending -> success/error/warn
    if (options.updatePending && activePendingId) {
        const old = document.getElementById(activePendingId);
        if (old) {
            old.querySelector('.toast-icon').textContent = cfg.icon;
            old.querySelector('.toast-text').textContent = text;

            old.className = 'toast ' + cfg.baseClass;
            if (type === 'error') {
                old.classList.add('toast-error-start');
            } else if (type === 'success') {
                old.classList.add('toast-success-start');
            } else if (type === 'warn') {
                old.classList.add('toast-warn-start');
            }

            setTimeout(() => {
                old.classList.remove('toast-error-start', 'toast-success-start', 'toast-warn-start');
            }, 300);

            activePendingId = null;

            if (timeout) {
                autoHideToast(old, timeout);
            }
            return id;
        }
    }

    // новое уведомление
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `toast ${cfg.baseClass}`;
    toast.innerHTML = `
        <div class="toast-icon">${cfg.icon}</div>
        <div class="toast-text">${text}</div>
        ${
            (type === 'success' || type === 'pending')
            ? ''
            : '<div class="toast-close">×</div>'
        }
    `;

    const closeEl = toast.querySelector('.toast-close');
    if (closeEl) closeEl.onclick = () => hideToast(toast);

    container.appendChild(toast);

    if (type === 'error') {
        toast.classList.add('toast-error-start');
    } else if (type === 'success') {
        toast.classList.add('toast-success-start');
    } else if (type === 'warn') {
        toast.classList.add('toast-warn-start');
    }

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.classList.remove('toast-error-start', 'toast-success-start', 'toast-warn-start');
    }, 300);

    let hover = false;
    toast.addEventListener('mouseenter', () => hover = true);
    toast.addEventListener('mouseleave', () => {
        hover = false;
        if (!timeout) return;
        autoHideToast(toast, 2000);
    });

    if (type === 'pending') {
        activePendingId = id;
    } else if (timeout) {
        autoHideToast(toast, timeout);
    }

    return id;
}

function autoHideToast(el, ms) {
    if (!ms) return;
    setTimeout(() => {
        if (el.matches(':hover')) return;
        hideToast(el);
    }, ms);
}

function hideToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 200);
}

// ---------- Settings ----------

function openSettings() {
    document.getElementById('settingsPanel').classList.add('open');
}

function closeSettings() {
    document.getElementById('settingsPanel').classList.remove('open');
}

function setupSettings() {
    const advToggle = document.getElementById('advancedModeToggle');
    const advInfo = document.getElementById('advancedInfo');

    advToggle.addEventListener('click', () => {
        advancedMode = !advancedMode;
        if (advancedMode) {
            advToggle.classList.add('on');
            advToggle.textContent = 'Вкл';
            advInfo.classList.remove('hidden');
        } else {
            advToggle.classList.remove('on');
            advToggle.textContent = 'Выкл';
            advInfo.classList.add('hidden');
        }
        renderMixer();
    });
}

// продвинутый лог

function _advancedMidiLogHandler(msg) {
    if (!advancedMode) return;
    const el = document.getElementById('advancedMidiLog');
    if (!el) return;

    const ts = new Date(msg.timestamp * 1000).toLocaleTimeString();
    let line = `[${ts}] ${msg.type}`;
    if (msg.type === 'control_change') {
        line += ` CC=${msg.control} val=${msg.value}`;
    }
    if (msg.type === 'pitchwheel') {
        line += ` pitch=${msg.pitch}`;
    }
    if (msg.type === 'note_on' || msg.type === 'note_off') {
        line += ` note=${msg.note} vel=${msg.velocity}`;
    }

    el.textContent = (el.textContent + '\n' + line).trim().split('\n').slice(-20).join('\n');
}

// ---------- Live MIDI control of faders + advanced log ----------

window.__onMidiFromPython = function (msg) {
    _advancedMidiLogHandler(msg);

    if (msg.type === 'control_change') {
        channels.forEach(ch => {
            if (ch.faderMapping &&
                ch.faderMapping.type === 'control_change' &&
                ch.faderMapping.control === msg.control &&
                ch.faderMapping.channel === msg.channel) {

                const vol = Math.round((msg.value / 127) * 100);
                ch.volume = Math.max(0, Math.min(100, vol));
            }
        });
    }

    if (msg.type === 'pitchwheel') {
        const pitch = msg.pitch ?? msg.value ?? 0;
        const norm = Math.max(-8192, Math.min(8191, pitch));
        const vol = Math.round(((norm + 8192) / 16383) * 100);

        channels.forEach(ch => {
            if (ch.faderMapping &&
                ch.faderMapping.type === 'pitchwheel' &&
                ch.faderMapping.channel === msg.channel) {

                ch.volume = Math.max(0, Math.min(100, vol));
            }
        });
    }

    updateFadersFromState();
};

// ---------- Init with pywebviewready ----------

function init() {
    loadAudioApps();
    loadProfileFromLocal();
    setupMidiInputs();

    const keyEl = document.getElementById('buttonKey');
    if (keyEl) keyEl.addEventListener('keydown', captureKey);

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', () => {
        document.getElementById('contextMenu').style.display = 'none';
    });
    document.querySelectorAll('#contextMenu .context-item')
        .forEach(item => item.addEventListener('click', onContextItemClick));

    setupSettings();
}

function safeInit() {
    try {
        if (window.pywebview && window.pywebview.api) {
            init();
        } else {
            setTimeout(safeInit, 200);
        }
    } catch (e) {
        console.error(e);
        setTimeout(safeInit, 200);
    }
}

window.addEventListener('pywebviewready', function () {
    init();
});

setTimeout(safeInit, 500);

// ---------- Audio apps ----------

async function loadAudioApps() {
    try {
        if (!window.pywebview || !window.pywebview.api) {
            console.warn('pywebview.api ещё не готов при loadAudioApps');
            return;
        }
        const res = await window.pywebview.api.get_audio_applications();
        audioApps = res.applications || [];
        logTest('audio_apps', audioApps);
    } catch (e) {
        console.error(e);
        audioApps = [
            { name: 'Chrome', process: 'chrome.exe' },
            { name: 'Spotify', process: 'spotify.exe' },
            { name: 'Discord', process: 'discord.exe' },
            { name: 'OBS Studio', process: 'obs64.exe' },
            { name: 'VLC', process: 'vlc.exe' },
            { name: 'Master Volume', process: 'master' }
        ];
    }
    updateAppSelectors();
}

function updateAppSelectors() {
    const select = document.getElementById('modalAppSelect');
    if (!select) return;
    select.innerHTML = audioApps.map(app =>
        `<option value="${app.process}">${app.name}</option>`
    ).join('');
}

// ---------- MIDI inputs ----------

async function setupMidiInputs() {
    const select = document.getElementById('midiInput');
    select.innerHTML = '<option value="">Выбрать MIDI устройство</option>';

    try {
        if (!window.pywebview || !window.pywebview.api) {
            console.warn('pywebview.api ещё не готов при setupMidiInputs');
            return;
        }
        const devices = await window.pywebview.api.get_midi_devices();
        logTest('midi_devices', devices);
        (devices.inputs || []).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        select.addEventListener('change', async (e) => {
            const name = e.target.value;
            if (!name) return;
            const res = await window.pywebview.api.connect_midi_input(name);
            if (res.success) {
                document.getElementById('statusDot').classList.add('connected');
                document.getElementById('statusText').textContent = 'Подключено';
                showToast('success', 'MIDI устройство подключено');
                logTest('midi_connected', name);
            } else {
                showToast('error', 'Ошибка MIDI: ' + res.error);
                logTest('midi_connect_error', { name, error: res.error });
            }
        });
    } catch (e) {
        console.error('setupMidiInputs error', e);
    }
}

// ---------- Channels ----------

function addChannel() {
    document.getElementById('channelModal').classList.add('active');
}

function closeModal() {
    document.getElementById('channelModal').classList.remove('active');
}

async function createChannel() {
    const app = document.getElementById('modalAppSelect').value;
    const buttonCount = parseInt(document.getElementById('modalButtonCount').value || '4', 10);

    if (!app) {
        showToast('error', 'Выберите приложение для канала');
        return;
    }

    const appObj = audioApps.find(a => a.process === app);
    const title = appObj ? appObj.name : app;

    const channel = {
        id: Date.now(),
        app: app,
        appName: title,
        title: title,
        faderCC: null,
        faderMapping: null,
        volume: 100,
        buttons: [],
        skipBinding: false,
        showBindHint: true
    };

    for (let i = 0; i < buttonCount; i++) {
        channel.buttons.push({
            id: Date.now() + i,
            text: `BTN ${i+1}`,
            icon: '🎵',
            note: 60 + i,
            key: null,
            active: false
        });
    }

    channels.push(channel);
    closeModal();
    renderMixer();
    saveProfileToLocal();
    logTest('createChannel', { app, buttonCount, channelId: channel.id });
    showToast('success', 'Канал добавлен. Можно привязать фейдер или оставить без привязки.');
}

function removeChannel(id) {
    channels = channels.filter(c => c.id !== id);
    renderMixer();
    saveProfileToLocal();
}

function changeChannelApp(channelId, app) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    channel.app = app;
    const obj = audioApps.find(a => a.process === app);
    channel.appName = obj ? obj.name : app;
    if (!channel.title) channel.title = channel.appName;
    saveProfileToLocal();
    renderMixer();
    logTest('changeChannelApp', { channelId, app });
}

function editChannelTitle(channelId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    const current = channel.title || channel.appName;
    const name = prompt('Название блока:', current);
    if (name === null) return;
    channel.title = name.trim() || channel.appName;
    saveProfileToLocal();
    renderMixer();
}

// ---------- Bind hint dismiss ----------

function dismissFaderBindHint(channelId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    channel.showBindHint = false;
    channel.skipBinding = true;
    saveProfileToLocal();

    // уведомление‑предупреждение
    showToast(
        'warn',
        'Фейдер этого канала работает без привязки к микшеру. Управлять им можно только из приложения.'
    );

    renderMixer();
}

// ---------- Bind fader (from hint) ----------

async function startBindFader(ev, channelId) {
    ev.stopPropagation();
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    logTest('startBindFader', { channelId, channel });

    showToast('pending', 'Подвигайте фейдер для канала «' + (channel.title || channel.appName) + '»');

    if (!window.pywebview || !window.pywebview.api) {
        logTest('startBindFader: pywebview.api NOT READY');
        showToast('error', 'pywebview.api не готов', { updatePending: true });
        return;
    }

    const startRes = await window.pywebview.api.start_midi_learn('fader');
    logTest('start_midi_learn result', startRes);

    let learned = null;

    for (let i = 0; i < 80; i++) {
        const res = await window.pywebview.api.get_last_midi_message();
        const msg = res && res.message;
        logTest('poll midi_learn', i, msg);

        if (msg) {
            if (msg.type === 'control_change' || msg.type === 'pitchwheel') {
                learned = msg;
                break;
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }

    const stopRes = await window.pywebview.api.stop_midi_learn();
    logTest('stop_midi_learn result', stopRes);

    if (!learned) {
        showToast('error', 'Не удалось прочитать движение фейдера', { updatePending: true });
        logTest('startBindFader: NO LEARNED MESSAGE');
        return;
    }

    logTest('startBindFader: LEARNED', learned);

    let cc;
    if (learned.type === 'control_change') {
        cc = learned.control;
    } else if (learned.type === 'pitchwheel') {
        cc = 0;
    } else {
        cc = 0;
    }

    const conflict = channels.find(c => c.id !== channelId && c.faderCC === cc);
    if (conflict) {
        const ok = confirm(
            `Этот контроллер уже используется каналом «${conflict.title || conflict.appName}». Всё равно назначить?`
        );
        if (!ok) {
            showToast('warn', 'Привязка фейдера отменена', { updatePending: true });
            logTest('startBindFader: USER CANCELED ON CONFLICT');
            return;
        }
    }

    channel.faderMapping = {
        type: learned.type,
        control: learned.control ?? null,
        channel: learned.channel ?? 0
    };
    channel.faderCC = cc;
    channel.showBindHint = false;
    channel.skipBinding = false;

    saveProfileToLocal();
    renderMixer();
    showToast('success', 'Фейдер подключен', { updatePending: true });
}

async function remapChannelFader(channelId) {
    const fakeEvent = { stopPropagation: () => {} };
    await startBindFader(fakeEvent, channelId);
}

// ---------- Buttons in channels ----------

function configureButton(channelId, buttonId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    const button = channel.buttons.find(b => b.id === buttonId);
    if (!button) return;

    currentButtonConfig = { channelId, buttonId, standalone: false };
    document.getElementById('buttonText').value = button.text;
    document.getElementById('buttonIcon').value = button.icon;
    document.getElementById('buttonNote').value = button.note;
    document.getElementById('buttonKey').value = button.key || '';
    document.getElementById('buttonModal').classList.add('active');
}

function toggleButton(channelId, buttonId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    const button = channel.buttons.find(b => b.id === buttonId);
    if (!button) return;
    button.active = !button.active;
    logTest('button_toggle', { channelId, buttonId, active: button.active });
    renderMixer();
    renderStandaloneButtons();
    sendButtonAction(button);
}

async function remapButton(channelId, buttonId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    const button = channel.buttons.find(b => b.id === buttonId);
    if (!button) return;

    logTest('remap_button_start', { channelId, buttonId });

    showToast('pending', 'Нажмите кнопку на микшере для привязки');

    await window.pywebview.api.start_midi_learn('button');

    let learned = null;
    for (let i = 0; i < 80; i++) {
        const res = await window.pywebview.api.get_last_midi_message();
        const msg = res && res.message;
        logTest('poll midi_learn_button', i, msg);
        if (msg && msg.type === 'note_on') {
            learned = msg;
            break;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    await window.pywebview.api.stop_midi_learn();

    if (!learned) {
        showToast('error', 'Не удалось прочитать кнопку', { updatePending: true });
        logTest('remap_button: NO LEARNED MESSAGE');
        return;
    }

    button.note = learned.note;
    saveProfileToLocal();
    renderMixer();
    showToast('success', `Кнопка привязана`, { updatePending: true });
    logTest('remap_button_learned', { channelId, buttonId, note: button.note });
}

// ---------- Standalone buttons ----------

function addStandaloneButton() {
    const button = {
        id: Date.now(),
        text: 'BTN',
        icon: '⭐',
        note: 70,
        key: null,
        active: false
    };
    standaloneButtonsList.push(button);
    renderStandaloneButtons();
    saveProfileToLocal();
}

function renderStandaloneButtons() {
    const container = document.getElementById('standaloneButtons');
    container.innerHTML = standaloneButtonsList.map(btn => `
        <div class="standalone-button ${btn.active ? 'active' : ''}"
             data-button-id="${btn.id}"
             onclick="toggleStandaloneButton(${btn.id})"
             ondblclick="configureStandaloneButton(${btn.id})">
            <div class="button-icon">${btn.icon}</div>
            <div class="button-label">${btn.text}</div>
        </div>
    `).join('');
}

function toggleStandaloneButton(id) {
    const button = standaloneButtonsList.find(b => b.id === id);
    if (!button) return;
    button.active = !button.active;
    logTest('standalone_button_toggle', { buttonId: id, active: button.active });
    renderStandaloneButtons();
    sendButtonAction(button);
}

function configureStandaloneButton(id) {
    const button = standaloneButtonsList.find(b => b.id === id);
    if (!button) return;
    currentButtonConfig = { standalone: true, buttonId: id };
    document.getElementById('buttonText').value = button.text;
    document.getElementById('buttonIcon').value = button.icon;
    document.getElementById('buttonNote').value = button.note;
    document.getElementById('buttonKey').value = button.key || '';
    document.getElementById('buttonModal').classList.add('active');
}

async function remapStandaloneButton(id) {
    const button = standaloneButtonsList.find(b => b.id === id);
    if (!button) return;

    logTest('remap_standalone_button_start', { buttonId: id });

    showToast('pending', 'Нажмите кнопку на микшере для привязки');

    await window.pywebview.api.start_midi_learn('button');

    let learned = null;
    for (let i = 0; i < 80; i++) {
        const res = await window.pywebview.api.get_last_midi_message();
        const msg = res && res.message;
        logTest('poll midi_learn_button_standalone', i, msg);
        if (msg && msg.type === 'note_on') {
            learned = msg;
            break;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    await window.pywebview.api.stop_midi_learn();

    if (!learned) {
        showToast('error', 'Не удалось прочитать кнопку', { updatePending: true });
        logTest('remap_standalone_button: NO LEARNED MESSAGE');
        return;
    }

    button.note = learned.note;
    saveProfileToLocal();
    renderStandaloneButtons();
    showToast('success', `Кнопка привязана`, { updatePending: true });
    logTest('remap_standalone_button_learned', { buttonId: id, note: button.note });
}

// ---------- Button modal ----------

function closeButtonModal() {
    document.getElementById('buttonModal').classList.remove('active');
    currentButtonConfig = null;
}

function saveButtonConfig() {
    if (!currentButtonConfig) return;
    const text = document.getElementById('buttonText').value;
    const icon = document.getElementById('buttonIcon').value;
    const note = parseInt(document.getElementById('buttonNote').value);
    const key = document.getElementById('buttonKey').value || null;

    if (currentButtonConfig.standalone) {
        const btn = standaloneButtonsList.find(b => b.id === currentButtonConfig.buttonId);
        if (btn) {
            btn.text = text;
            btn.icon = icon;
            btn.note = note;
            btn.key = key;
        }
        renderStandaloneButtons();
    } else {
        const channel = channels.find(c => c.id === currentButtonConfig.channelId);
        if (channel) {
            const btn = channel.buttons.find(b => b.id === currentButtonConfig.buttonId);
            if (btn) {
                btn.text = text;
                btn.icon = icon;
                btn.note = note;
                btn.key = key;
            }
        }
        renderMixer();
    }

    saveProfileToLocal();
    closeButtonModal();
}

function captureKey(e) {
    e.preventDefault();
    document.getElementById('buttonKey').value = e.key.toUpperCase();
}

// ---------- Fader drag + optimized update ----------

function setupFaderDrag() {
    document.querySelectorAll('.fader-track').forEach(track => {
        const channelId = parseInt(track.dataset.channel);
        const thumb = track.querySelector('.fader-thumb');
        const fill = track.querySelector('.fader-fill');
        const valueEl = track.parentElement.querySelector('.volume-value');

        let isDragging = false;

        const applyVolume = (vol) => {
            const channel = channels.find(c => c.id === channelId);
            if (!channel) return;
            channel.volume = vol;

            thumb.style.bottom = `calc(${vol}% - 10px)`;
            fill.style.height = `${vol}%`;
            valueEl.textContent = `${vol}%`;

            if (window.pywebview && window.pywebview.api) {
                window.pywebview.api.set_app_volume(channel.app, vol);
            }
        };

        const updateVolume = (e) => {
            const rect = track.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const h = rect.height;
            let vol = Math.round(((h - y) / h) * 100);
            vol = Math.max(0, Math.min(100, vol));
            applyVolume(vol);
        };

        thumb.addEventListener('mousedown', (e) => {
            isDragging = true;
            e.preventDefault();
            e.stopPropagation();
        });
        track.addEventListener('click', (e) => {
            e.stopPropagation();
            updateVolume(e);
        });
        document.addEventListener('mousemove', (e) => {
            if (isDragging) updateVolume(e);
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                saveProfileToLocal();
            }
        });
    });
}

function updateFadersFromState() {
    channels.forEach(ch => {
        const track = document.querySelector(`.fader-track[data-channel="${ch.id}"]`);
        if (!track) return;
        const thumb = track.querySelector('.fader-thumb');
        const fill = track.querySelector('.fader-fill');
        const valueEl = track.parentElement.querySelector('.volume-value');
        if (!thumb || !fill || !valueEl) return;

        const vol = ch.volume;
        thumb.style.bottom = `calc(${vol}% - 10px)`;
        fill.style.height = `${vol}%`;
        valueEl.textContent = `${vol}%`;
    });
}

// ---------- Rendering ----------

function renderMixer() {
    const container = document.getElementById('mixerContainer');

    if (channels.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎛️</div>
                <div class="empty-state-text">
                    Нажмите «+» справа, чтобы добавить канал<br>
                    или «+ Кнопка» для отдельной кнопки
                </div>
            </div>
            <div class="add-channel-strip" onclick="addChannel()">
                <div class="add-channel-plus">+</div>
            </div>
        `;
        return;
    }

    container.innerHTML =
        channels.map(channel => `
            <div class="channel-strip" data-channel-id="${channel.id}">
                
                <div class="channel-header">
                    <div class="channel-name"
                         title="${(channel.title || channel.appName)}"
                         ondblclick="editChannelTitle(${channel.id})">
                        ${channel.title || channel.appName}
                    </div>
                    <button class="btn-remove"
                            onclick="removeChannel(${channel.id}); event.stopPropagation();">×</button>
                </div>

                <div class="channel-body">
                    <div class="fader-container">
                        ${
                            advancedMode && channel.faderMapping
                            ? `<div class="fader-meta">
                                   ${channel.faderMapping.type === 'control_change'
                                       ? 'control_change (CC ' + channel.faderMapping.control + ')'
                                       : 'pitchwheel (ch ' + channel.faderMapping.channel + ')'}
                               </div>`
                            : ''
                        }
                        <div class="fader-track" data-channel="${channel.id}">
                            <div class="fader-fill" style="height: ${channel.volume}%"></div>
                            <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 10px)"></div>
                        </div>
                        <div class="volume-value">${channel.volume}%</div>

                        ${
                            !channel.faderMapping && channel.showBindHint
                            ? `
                            <div class="fader-bind-bar">
                                <span class="fader-bind-text"
                                      onclick="startBindFader(event, ${channel.id})">
                                    Привязать к микшеру
                                </span>
                                <button class="fader-bind-close"
                                        onclick="dismissFaderBindHint(${channel.id}); event.stopPropagation();">
                                    ×
                                </button>
                            </div>
                            `
                            : ''
                        }
                    </div>

                    <select class="app-selector"
                            onchange="changeChannelApp(${channel.id}, this.value)">
                        ${audioApps.map(app =>
                            `<option value="${app.process}" ${app.process === channel.app ? 'selected' : ''}>${app.name}</option>`
                        ).join('')}
                    </select>

                    <div class="button-group">
                        ${channel.buttons.map(btn => `
                            <button class="control-button ${btn.active ? 'active' : ''}"
                                    data-button-id="${btn.id}"
                                    onclick="toggleButton(${channel.id}, ${btn.id})"
                                    ondblclick="configureButton(${channel.id}, ${btn.id})">
                                ${btn.icon ? btn.icon : ''} ${btn.text}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `).join('') +
        `
        <div class="add-channel-strip" onclick="addChannel()">
            <div class="add-channel-plus">+</div>
        </div>
        `;

    setupFaderDrag();
}

// ---------- Context menu ----------

function onContextMenu(e) {
    const channelEl = e.target.closest('.channel-strip');
    const buttonEl = e.target.closest('.control-button');
    const standaloneEl = e.target.closest('.standalone-button');

    if (!channelEl && !buttonEl && !standaloneEl) return;

    e.preventDefault();

    if (buttonEl) {
        const channelId = parseInt(buttonEl.closest('.channel-strip').dataset.channelId);
        const buttonId = parseInt(buttonEl.dataset.buttonId);
        contextTarget = { type: 'button', channelId, buttonId };
    } else if (standaloneEl) {
        const buttonId = parseInt(standaloneEl.dataset.buttonId);
        contextTarget = { type: 'standalone', buttonId };
    } else if (channelEl) {
        const channelId = parseInt(channelEl.dataset.channelId);
        contextTarget = { type: 'channel', channelId };
    }

    const menu = document.getElementById('contextMenu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.display = 'block';
}

function onContextItemClick(e) {
    const action = e.target.dataset.action;
    const menu = document.getElementById('contextMenu');
    menu.style.display = 'none';
    handleContextAction(action);
}

function handleContextAction(action) {
    if (!contextTarget) return;

    if (contextTarget.type === 'channel') {
        const id = contextTarget.channelId;
        if (action === 'delete') removeChannel(id);
        if (action === 'remap') remapChannelFader(id);
        if (action === 'edit')  editChannelTitle(id);
    } else if (contextTarget.type === 'button') {
        const { channelId, buttonId } = contextTarget;
        const channel = channels.find(c => c.id === channelId);
        if (!channel) return;
        if (action === 'delete') {
            channel.buttons = channel.buttons.filter(b => b.id !== buttonId);
            saveProfileToLocal();
            renderMixer();
        }
        if (action === 'remap') remapButton(channelId, buttonId);
        if (action === 'edit')  configureButton(channelId, buttonId);
    } else if (contextTarget.type === 'standalone') {
        const id = contextTarget.buttonId;
        if (action === 'delete') {
            standaloneButtonsList = standaloneButtonsList.filter(b => b.id !== id);
            saveProfileToLocal();
            renderStandaloneButtons();
        }
        if (action === 'remap') remapStandaloneButton(id);
        if (action === 'edit')  configureStandaloneButton(id);
    }
}

// ---------- Profiles (localStorage) ----------

function saveProfileToLocal() {
    const profile = { channels, standaloneButtons: standaloneButtonsList };
    localStorage.setItem('mixer_profile', JSON.stringify(profile));
}

function loadProfileFromLocal() {
    const saved = localStorage.getItem('mixer_profile');
    if (!saved) {
        renderMixer();
        renderStandaloneButtons();
        return;
    }
    try {
        const profile = JSON.parse(saved);
        channels = profile.channels || [];
        standaloneButtonsList = profile.standaloneButtons || [];
    } catch (e) {
        console.error('loadProfile error', e);
    }
    renderMixer();
    renderStandaloneButtons();
}

function openProfileModal() {
    showToast('warn', 'UI профилей пока не реализован, но Python API есть.');
}

// ---------- Backend stubs ----------

function sendButtonAction(button) {
    logTest('sendButtonAction', {
        note: button.note,
        active: button.active,
        text: button.text
    });
    if (!window.pywebview || !window.pywebview.api) return;
    window.pywebview.api.send_midi_note(button.note, button.active ? 127 : 0);
}
