const MAX_CHANNEL_BUTTONS = 4;
const MAX_STANDALONE_BUTTONS = 24;
let standaloneButtonsUiStateSyncInitialized = false;

function findChannel(channelId) {
  return typeof findChannelState === 'function' ? findChannelState(channelId) : null;
}

function findStandaloneButton(buttonId) {
  return typeof findStandaloneButtonState === 'function' ? findStandaloneButtonState(buttonId) : null;
}

function createDefaultButton() {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    text: t('buttons.defaultLabel'),
    icon: 'BTN',
    note: 70,
    key: null,
    active: false
  };
}

function addChannelButton(channelId) {
  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  if (channel.buttons.length >= MAX_CHANNEL_BUTTONS) {
    showToast('warn', t('buttons.channelLimit'));
    return;
  }

  addChannelButtonState?.(channelId, createDefaultButton(), { source: 'ui' });
  saveProfileToLocal();
}

function fillButtonModal(button) {
  document.getElementById('buttonText').value = button.text;
  document.getElementById('buttonIcon').value = button.icon;
  document.getElementById('buttonNote').value = button.note;
  document.getElementById('buttonKey').value = button.key || '';
  document.getElementById('buttonModal').classList.add('active');
}

function openButtonEditor(config, button) {
  currentButtonConfig = config;
  fillButtonModal(button);
}

function configureButton(channelId, buttonId) {
  const channel = findChannel(channelId);
  const button = channel?.buttons.find((item) => item.id === buttonId);

  if (!button) {
    return;
  }

  openButtonEditor({ channelId, buttonId, standalone: false }, button);
}

function toggleButton(channelId, buttonId) {
  const button = toggleChannelButtonState?.(channelId, buttonId, { source: 'ui' });

  if (!button) {
    return;
  }

  logTest('button_toggle', { channelId, buttonId, active: button.active });
  sendButtonAction(button);
}

async function remapButton() {
  showToast('warn', t('buttons.buttonLearnMissing'));
}

function addStandaloneButton() {
  if ((getStandaloneButtonsState?.() || []).length >= MAX_STANDALONE_BUTTONS) {
    showToast('warn', t('buttons.standaloneLimit'));
    return;
  }

  addStandaloneButtonState?.(createDefaultButton(), { source: 'ui' });
  saveProfileToLocal();
}

function renderStandaloneButtons() {
  const container = document.getElementById('standaloneButtons');
  const standaloneButtonsList = getStandaloneButtonsState?.() || [];

  if (!container) {
    return;
  }

  const buttonsMarkup = standaloneButtonsList
    .map((button) => `
      <div class="standalone-button ${button.active ? 'active' : ''}"
           data-button-id="${button.id}"
           onclick="toggleStandaloneButton(${button.id})"
           ondblclick="configureStandaloneButton(${button.id})">
        <div class="button-icon">${button.icon}</div>
        <div class="button-label">${button.text}</div>
      </div>
    `)
    .join('');

  const addMarkup = standaloneButtonsList.length < MAX_STANDALONE_BUTTONS
    ? `
      <div class="standalone-add-strip" onclick="addStandaloneButton()">
        <div class="add-channel-plus">+</div>
      </div>
    `
    : '';

  container.innerHTML = `${buttonsMarkup}${addMarkup}`;
  scheduleContentMetricsUpdate();
}

function toggleStandaloneButton(buttonId) {
  const button = updateStandaloneButtonState?.(buttonId, (draftButton) => {
    draftButton.active = !draftButton.active;
    return draftButton;
  }, {
    type: 'standalone-buttons/toggle',
    source: 'ui'
  });

  if (!button) {
    return;
  }

  logTest('standalone_button_toggle', { buttonId, active: button.active });
  sendButtonAction(button);
}

function configureStandaloneButton(buttonId) {
  const button = findStandaloneButton(buttonId);

  if (!button) {
    return;
  }

  openButtonEditor({ standalone: true, buttonId }, button);
}

async function remapStandaloneButton() {
  showToast('warn', t('buttons.standaloneLearnMissing'));
}

function closeButtonModal() {
  document.getElementById('buttonModal').classList.remove('active');
  currentButtonConfig = null;
}

function readButtonFormState() {
  return {
    text: document.getElementById('buttonText').value.trim() || t('buttons.defaultLabel'),
    icon: document.getElementById('buttonIcon').value.trim() || 'BTN',
    note: Number.parseInt(document.getElementById('buttonNote').value, 10) || 0,
    key: document.getElementById('buttonKey').value || null
  };
}

function applyButtonConfig(button, config) {
  button.text = config.text;
  button.icon = config.icon;
  button.note = config.note;
  button.key = config.key;
}

function saveButtonConfig() {
  if (!currentButtonConfig) {
    return;
  }

  const nextConfig = readButtonFormState();

  if (currentButtonConfig.standalone) {
    updateStandaloneButtonState?.(currentButtonConfig.buttonId, (standaloneButton) => {
      applyButtonConfig(standaloneButton, nextConfig);
      return standaloneButton;
    }, {
      type: 'standalone-buttons/configure',
      source: 'ui'
    });
  } else {
    updateChannelButtonState?.(
      currentButtonConfig.channelId,
      currentButtonConfig.buttonId,
      (channelButton) => {
        applyButtonConfig(channelButton, nextConfig);
        return channelButton;
      },
      {
        type: 'channels/button-configure',
        source: 'ui'
      }
    );
  }

  saveProfileToLocal();
  closeButtonModal();
}

function captureKey(event) {
  event.preventDefault();
  document.getElementById('buttonKey').value = event.key.toUpperCase();
}

function sendButtonAction(button) {
  logTest('sendButtonAction', {
    note: button.note,
    active: button.active,
    text: button.text
  });
}

function initStandaloneButtonsStateSync() {
  if (standaloneButtonsUiStateSyncInitialized || typeof subscribeAppState !== 'function') {
    return;
  }

  subscribeAppState((nextState, previousState) => {
    if (nextState.standaloneButtons === previousState.standaloneButtons) {
      return;
    }

    renderStandaloneButtons();
  });

  standaloneButtonsUiStateSyncInitialized = true;
}
