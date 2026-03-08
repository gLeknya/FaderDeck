// web/js/midi-ui.js
// MIDI-related UI: advanced log, live fader updates, MIDI learn for faders (через WebMIDI)

let midiAccess = null;

async function initWebMIDI() {
  if (!navigator.requestMIDIAccess) {
    console.warn('Web MIDI API not supported in this environment');
    showToast('error', 'Web MIDI API not supported');
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    console.log('WebMIDI ready', midiAccess);

    midiAccess.inputs.forEach(input => {
      console.log('MIDI input:', input.name);
      input.onmidimessage = onWebMidiMessage;
    });

    midiAccess.onstatechange = (e) => {
      console.log('MIDI state change', e.port.name, e.port.state, e.port.type);
      if (e.port.type === 'input' && e.port.state === 'connected') {
        e.port.onmidimessage = onWebMidiMessage;
      }
    };

    showToast('success', 'WebMIDI initialized');
  } catch (e) {
    console.error('WebMIDI error', e);
    showToast('error', 'WebMIDI initialization failed');
  }
}

function onWebMidiMessage(e) {
  const [status, d1, d2] = e.data;
  const typeNibble = status & 0xF0;
  const channel = status & 0x0F;

  const msg = {
    type: null,
    note: null,
    velocity: null,
    control: null,
    value: null,
    channel,
    timestamp: e.timeStamp / 1000
  };

  if (typeNibble === 0x90) {
    msg.type = 'note_on';
    msg.note = d1;
    msg.velocity = d2;
  } else if (typeNibble === 0x80) {
    msg.type = 'note_off';
    msg.note = d1;
    msg.velocity = d2;
  } else if (typeNibble === 0xB0) {
    msg.type = 'control_change';
    msg.control = d1;
    msg.value = d2;
  }

  if (window.__onMidiFromPython) {
    window.__onMidiFromPython(msg);
  }
}

function _advancedMidiLogHandler(msg) {
  if (!advancedMode) return;
  const el = document.getElementById('advancedMidiLog');
  if (!el) return;

  const ts = new Date(msg.timestamp * 1000).toLocaleTimeString();
  let line = `[${ts}] ${msg.type}`;
  if (msg.type === 'control_change') {
    line += ` CC=${msg.control} val=${msg.value}`;
  }
  if (msg.type === 'note_on' || msg.type === 'note_off') {
    line += ` note=${msg.note} vel=${msg.velocity}`;
  }

  el.textContent = (el.textContent + '\n' + line).trim().split('\n').slice(-20).join('\n');
}

// global MIDI callback (WebMIDI использует то же имя)
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

  updateFadersFromState();
};

// Bind fader (упрощённый learn на фронте)

async function startBindFader(ev, channelId) {
  ev.stopPropagation();
  const channel = channels.find(c => c.id === channelId);
  if (!channel) return;

  logTest('startBindFader', { channelId, channel });

  showToast(
    'pending',
    `Move the fader for channel "${channel.title || channel.appName}"`
  );

  if (!midiAccess) {
    showToast('error', 'WebMIDI not initialized', { updatePending: true });
    return;
  }

  let learned = null;

  const handler = (e) => {
    const [status, d1, d2] = e.data;
    const typeNibble = status & 0xF0;
    const ch = status & 0x0F;

    if (typeNibble === 0xB0) {
      learned = {
        type: 'control_change',
        control: d1,
        value: d2,
        channel: ch
      };
    }
  };

  midiAccess.inputs.forEach(input => {
    input.addEventListener('midimessage', handler);
  });

  for (let i = 0; i < 80; i++) {
    if (learned) break;
    await new Promise(r => setTimeout(r, 100));
  }

  midiAccess.inputs.forEach(input => {
    input.removeEventListener('midimessage', handler);
  });

  if (!learned) {
    showToast('error', 'Failed to detect fader movement', { updatePending: true });
    logTest('startBindFader: NO LEARNED MESSAGE');
    return;
  }

  logTest('startBindFader: LEARNED', learned);

  const cc = learned.control;

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
