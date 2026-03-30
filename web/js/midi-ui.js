let midiAccess = null;
let midiInputCount = 0;

function updateMidiStatus(isConnected, text) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  statusDot?.classList.toggle('connected', isConnected);

  if (statusText) {
    statusText.textContent = text;
  }
}

function populateMidiInputs() {
  const select = document.getElementById('midiInput');

  if (!select) {
    return;
  }

  const inputs = midiAccess ? Array.from(midiAccess.inputs.values()) : [];
  midiInputCount = inputs.length;

  select.innerHTML = `
    <option value="">${t('toolbar.selectMidi')}</option>
    ${inputs.map((input) => `<option value="${input.id}">${input.name}</option>`).join('')}
  `;

  updateMidiStatus(
    inputs.length > 0,
    inputs.length > 0 ? t('status.devices', { count: inputs.length }) : t('status.notConnected')
  );
}

function refreshMidiUiLanguage() {
  const select = document.getElementById('midiInput');

  if (select?.options?.length) {
    select.options[0].textContent = t('toolbar.selectMidi');
  }

  if (midiInputCount > 0) {
    updateMidiStatus(true, t('status.devices', { count: midiInputCount }));
    return;
  }

  if (midiAccess) {
    updateMidiStatus(false, t('status.notConnected'));
  }
}

function bindMidiInput(port) {
  if (port?.type === 'input') {
    port.onmidimessage = onWebMidiMessage;
  }
}

async function initWebMIDI() {
  if (!navigator.requestMIDIAccess) {
    console.warn('Web MIDI API not supported in this environment');
    updateMidiStatus(false, t('status.unsupported'));
    showToast('error', t('midi.unsupported'));
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    console.log('WebMIDI ready', midiAccess);

    midiAccess.inputs.forEach((input) => {
      console.log('MIDI input:', input.name);
      bindMidiInput(input);
    });

    populateMidiInputs();

    midiAccess.onstatechange = (event) => {
      console.log('MIDI state change', event.port.name, event.port.state, event.port.type);

      if (event.port.type === 'input' && event.port.state === 'connected') {
        bindMidiInput(event.port);
      }

      populateMidiInputs();
    };

    showToast('success', t('midi.initialized'));
  } catch (error) {
    console.error('WebMIDI error', error);
    updateMidiStatus(false, t('status.connectionFailed'));
    showToast('error', t('midi.initFailed'));
  }
}

function createMidiMessage(event) {
  const [status, data1, data2] = event.data;
  const typeNibble = status & 0xF0;
  const channel = status & 0x0F;

  const baseMessage = {
    type: null,
    note: null,
    velocity: null,
    control: null,
    value: null,
    channel,
    timestamp: event.timeStamp / 1000
  };

  if (typeNibble === 0x90) {
    return { ...baseMessage, type: 'note_on', note: data1, velocity: data2 };
  }

  if (typeNibble === 0x80) {
    return { ...baseMessage, type: 'note_off', note: data1, velocity: data2 };
  }

  if (typeNibble === 0xB0) {
    return { ...baseMessage, type: 'control_change', control: data1, value: data2 };
  }

  return null;
}

function onWebMidiMessage(event) {
  const message = createMidiMessage(event);

  if (message && window.__onMidiFromPython) {
    window.__onMidiFromPython(message);
  }
}

function advancedMidiLogHandler(message) {
  if (!advancedMode) {
    return;
  }

  const logElement = document.getElementById('advancedMidiLog');

  if (!logElement) {
    return;
  }

  const time = new Date(message.timestamp * 1000).toLocaleTimeString();
  let line = `[${time}] ${message.type}`;

  if (message.type === 'control_change') {
    line += ` CC=${message.control} val=${message.value}`;
  }

  if (message.type === 'note_on' || message.type === 'note_off') {
    line += ` note=${message.note} vel=${message.velocity}`;
  }

  logElement.textContent = `${logElement.textContent}\n${line}`
    .trim()
    .split('\n')
    .slice(-20)
    .join('\n');
}

window.__onMidiFromPython = function handleMidiMessage(message) {
  advancedMidiLogHandler(message);

  if (message.type !== 'control_change') {
    return;
  }

  channels.forEach((channel) => {
    const mapping = channel.faderMapping;

    if (
      mapping &&
      mapping.type === 'control_change' &&
      mapping.control === message.control &&
      mapping.channel === message.channel
    ) {
      channel.volume = clampVolume(Math.round((message.value / 127) * 100));
    }
  });

  updateFadersFromState();
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function learnFaderMessage() {
  let learnedMessage = null;

  const handler = (event) => {
    const [status, control, value] = event.data;
    const typeNibble = status & 0xF0;
    const channel = status & 0x0F;

    if (typeNibble === 0xB0) {
      learnedMessage = {
        type: 'control_change',
        control,
        value,
        channel
      };
    }
  };

  midiAccess.inputs.forEach((input) => {
    input.addEventListener('midimessage', handler);
  });

  for (let attempt = 0; attempt < 80 && !learnedMessage; attempt += 1) {
    await wait(100);
  }

  midiAccess.inputs.forEach((input) => {
    input.removeEventListener('midimessage', handler);
  });

  return learnedMessage;
}

async function startBindFader(event, channelId) {
  event.stopPropagation();

  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  showToast('pending', t('midi.moveFader', { name: channel.title || channel.appName }));

  if (!midiAccess) {
    showToast('error', t('midi.initFailed'), { updatePending: true });
    return;
  }

  const learned = await learnFaderMessage();

  if (!learned) {
    showToast('error', t('midi.failedToDetect'), { updatePending: true });
    logTest('startBindFader: NO LEARNED MESSAGE');
    return;
  }

  const conflict = channels.find((item) => item.id !== channelId && item.faderCC === learned.control);

  if (conflict) {
    const conflictName = conflict.title || conflict.appName;
    const confirmed = confirm(t('midi.conflict', { name: conflictName }));

    if (!confirmed) {
      showToast('warn', t('midi.bindCancelled'), { updatePending: true });
      logTest('startBindFader: USER CANCELED ON CONFLICT');
      return;
    }
  }

  channel.faderMapping = {
    type: learned.type,
    control: learned.control ?? null,
    channel: learned.channel ?? 0
  };
  channel.faderCC = learned.control;
  channel.showBindHint = false;
  channel.skipBinding = false;

  saveProfileToLocal();
  renderMixer();
  showToast('success', t('midi.bindSuccess'), { updatePending: true });
}

async function remapChannelFader(channelId) {
  await startBindFader({ stopPropagation() {} }, channelId);
}
