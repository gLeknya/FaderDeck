// Channels: create/remove, app selection, fader bind hint, drag, render

function addChannel() {
    document.getElementById('channelModal').classList.add('active');
}

function closeModal() {
    document.getElementById('channelModal').classList.remove('active');
}

async function createChannel() {
    // next channel index
    const index = channels.length + 1;
    const title = `Channel ${index}`;

    const channel = {
        id: Date.now(),
        app: null,            // no app bound yet
        appName: '',
        title: title,
        faderCC: null,
        faderMapping: null,
        volume: 100,
        buttons: [],
        skipBinding: false,
        showBindHint: true,
        flashOnCreate: true   // флаг для анимации вспышки
    };

    // по умолчанию без кнопок, или можешь оставить 4:
    // for (let i = 0; i < 4; i++) { ... }

    channels.push(channel);
    renderMixer();
    saveProfileToLocal();
    logTest('createChannel', { channelId: channel.id, title });

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
    const name = prompt('Channel name:', current);
    if (name === null) return;
    channel.title = name.trim() || channel.appName;
    saveProfileToLocal();
    renderMixer();
}

// Bind hint dismiss

function dismissFaderBindHint(channelId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    channel.showBindHint = false;
    channel.skipBinding = true;
    saveProfileToLocal();

    showToast(
        'warn',
        'This fader is not bound to a MIDI control. It will only respond to the UI.'
    );

    renderMixer();
}

// Fader drag + update

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

// Rendering

function renderMixer() {
    const container = document.getElementById('mixerContainer');

    if (channels.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎛️</div>
                <div class="empty-state-text">
                    Click “+” on the right to add a channel<br>
                    or “+ Button” to add a standalone button
                </div>
            </div>
            <div class="add-channel-strip" onclick="createChannel()">
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
                                    Bind to mixer
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
        <div class="add-channel-strip" onclick="createChannel()">
            <div class="add-channel-plus">+</div>
        </div>
        `;

    setupFaderDrag();
    
    channels.forEach(ch => {
            if (!ch.flashOnCreate) return;
            const el = document.querySelector(`.channel-strip[data-channel-id="${ch.id}"]`);
            if (!el) return;
            el.classList.add('flash');
            ch.flashOnCreate = false;
            // после анимации класс можно не снимать, но можно и снять для чистоты
            setTimeout(() => {
                el.classList.remove('flash');
            }, 250);
        });
}