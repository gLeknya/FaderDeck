// Buttons logic (channel buttons + standalone buttons)

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

    showToast('pending', 'Press a button on the mixer to bind');

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
        showToast('error', 'Could not read button press', { updatePending: true });
        logTest('remap_button: NO LEARNED MESSAGE');
        return;
    }

    button.note = learned.note;
    saveProfileToLocal();
    renderMixer();
    showToast('success', 'Button bound', { updatePending: true });
    logTest('remap_button_learned', { channelId, buttonId, note: button.note });
}

// Standalone buttons

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

    showToast('pending', 'Press a button on the mixer to bind');

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
        showToast('error', 'Could not read button press', { updatePending: true });
        logTest('remap_standalone_button: NO LEARNED MESSAGE');
        return;
    }

    button.note = learned.note;
    saveProfileToLocal();
    renderStandaloneButtons();
    showToast('success', 'Button bound', { updatePending: true });
    logTest('remap_standalone_button_learned', { buttonId: id, note: button.note });
}

// Button modal

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

// Backend stub for button actions

function sendButtonAction(button) {
    logTest('sendButtonAction', {
        note: button.note,
        active: button.active,
        text: button.text
    });
    if (!window.pywebview || !window.pywebview.api) return;
    window.pywebview.api.send_midi_note(button.note, button.active ? 127 : 0);
}
