// web/js/buttons.js
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
  // Для WebMIDI можно реализовать свой learn позже; пока просто лог
  showToast('warn', 'Button MIDI learn is not implemented yet (WebMIDI).');
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

  const plusHtml = `
    <div class="standalone-button standalone-add" onclick="addStandaloneButton()">
      <div class="button-icon">+</div>
    </div>
  `;

  const buttonsHtml = standaloneButtonsList.map(btn => `
    <div class="standalone-button ${btn.active ? 'active' : ''}"
         data-button-id="${btn.id}"
         onclick="toggleStandaloneButton(${btn.id})"
         ondblclick="configureStandaloneButton(${btn.id})">
      <div class="button-icon">${btn.icon}</div>
      <div class="button-label">${btn.text}</div>
    </div>
  `).join('');

  container.innerHTML = plusHtml + buttonsHtml;
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
  showToast('warn', 'Standalone button MIDI learn is not implemented yet (WebMIDI).');
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
  // Здесь можно позже отправлять MIDI через WebMIDI (output)
}
