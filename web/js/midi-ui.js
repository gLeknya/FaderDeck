// MIDI-related UI: advanced log, live fader updates, MIDI learn for faders

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

// global MIDI callback from Python
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

// Bind fader

async function startBindFader(ev, channelId) {
    ev.stopPropagation();
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    logTest('startBindFader', { channelId, channel });

    showToast(
    'pending',
    `Move the fader for channel "${channel.title || channel.appName}"`
);


    if (!window.pywebview || !window.pywebview.api) {
        logTest('startBindFader: pywebview.api NOT READY');
        showToast('error', 'pywebview.api is not ready', { updatePending: true });
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
        showToast('error', 'Failed to detect fader movement', { updatePending: true });
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
            `This controller is already used by channel “${conflict.title || conflict.appName}”. Bind anyway?`
        );
        if (!ok) {
            showToast('warn', 'Fader binding cancelled', { updatePending: true });
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
    showToast('success', 'Fader bound', { updatePending: true });
}

async function remapChannelFader(channelId) {
    const fakeEvent = { stopPropagation: () => {} };
    await startBindFader(fakeEvent, channelId);
}
