function findChannel(channelId) {
  return channels.find((channel) => channel.id === channelId) ?? null;
}

function findStandaloneButton(buttonId) {
  return standaloneButtonsList.find((button) => button.id === buttonId) ?? null;
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
  const channel = findChannel(channelId);
  const button = channel?.buttons.find((item) => item.id === buttonId);

  if (!button) {
    return;
  }

  button.active = !button.active;
  logTest('button_toggle', { channelId, buttonId, active: button.active });
  renderMixer();
  renderStandaloneButtons();
  sendButtonAction(button);
}

async function remapButton() {
  showToast('warn', t('buttons.buttonLearnMissing'));
}

function createDefaultButton() {
  return {
    id: Date.now(),
    text: t('buttons.defaultLabel'),
    icon: '*',
    note: 70,
    key: null,
    active: false
  };
}

function addStandaloneButton() {
  standaloneButtonsList.push(createDefaultButton());
  renderStandaloneButtons();
  saveProfileToLocal();
}

function renderStandaloneButtons() {
  const container = document.getElementById('standaloneButtons');

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

  container.innerHTML = `
    ${buttonsMarkup}
    <div class="standalone-add-strip" onclick="addStandaloneButton()">
      <div class="add-channel-plus">+</div>
    </div>
  `;
}

function toggleStandaloneButton(buttonId) {
  const button = findStandaloneButton(buttonId);

  if (!button) {
    return;
  }

  button.active = !button.active;
  logTest('standalone_button_toggle', { buttonId, active: button.active });
  renderStandaloneButtons();
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
    icon: document.getElementById('buttonIcon').value.trim() || '*',
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
    const standaloneButton = findStandaloneButton(currentButtonConfig.buttonId);

    if (standaloneButton) {
      applyButtonConfig(standaloneButton, nextConfig);
    }

    renderStandaloneButtons();
  } else {
    const channel = findChannel(currentButtonConfig.channelId);
    const channelButton = channel?.buttons.find(
      (button) => button.id === currentButtonConfig.buttonId
    );

    if (channelButton) {
      applyButtonConfig(channelButton, nextConfig);
    }

    renderMixer();
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
