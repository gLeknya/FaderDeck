const CUSTOM_DROPDOWN_STATE = new WeakMap();
const CUSTOM_DROPDOWN_SELECTS = new Set();
let customDropdownGlobalEventsBound = false;

function escapeDropdownHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getDropdownVariant(select) {
  if (select.id === 'toolbarProfileSelect') {
    return 'toolbar';
  }

  if (select.id === 'midiInput') {
    return 'midi';
  }

  if (select.classList.contains('settings-select')) {
    return 'settings';
  }

  if (select.classList.contains('app-selector')) {
    return 'channel';
  }

  return 'default';
}

function getDropdownPanel(dropdown) {
  return dropdown?._customSelectPanel || null;
}

function setDropdownOpen(dropdown, isOpen) {
  if (!dropdown?.classList.contains('custom-select')) {
    return;
  }

  const panel = getDropdownPanel(dropdown);
  dropdown.classList.toggle('open', isOpen);
  panel?.classList.toggle('is-open', isOpen);
  dropdown
    .querySelector('.custom-select-trigger')
    ?.setAttribute('aria-expanded', String(isOpen));
}

function closeAllCustomDropdowns(exceptSelect = null) {
  document.querySelectorAll('.custom-select.open').forEach((dropdown) => {
    const originalSelect = dropdown.previousElementSibling;

    if (originalSelect === exceptSelect) {
      return;
    }

    setDropdownOpen(dropdown, false);
  });
}

function cleanupDetachedCustomSelects() {
  CUSTOM_DROPDOWN_SELECTS.forEach((select) => {
    if (select.isConnected) {
      return;
    }

    const state = CUSTOM_DROPDOWN_STATE.get(select);
    state?.observer?.disconnect();
    state?.panel?.remove();
    CUSTOM_DROPDOWN_STATE.delete(select);
    CUSTOM_DROPDOWN_SELECTS.delete(select);
  });
}

function getSelectTargets(root = document) {
  if (!root) {
    return [];
  }

  if (root.matches?.('select')) {
    return [root];
  }

  return Array.from(root.querySelectorAll('select'));
}

function repositionOpenCustomDropdowns() {
  document.querySelectorAll('.custom-select.open').forEach((dropdown) => {
    updateDropdownPlacement(dropdown);
  });
}

function buildCustomDropdownOptions(select, dropdown) {
  const panel = getDropdownPanel(dropdown);
  const selectedValue = select.value;
  const statusLabel = select.dataset.dropdownStatusLabel || '';
  const isLoading = select.dataset.dropdownLoading === 'true';
  const options = Array.from(select.options).filter(
    (option) => option.value !== ''
  );

  const optionsMarkup = (!isLoading ? options : [])
    .map(
      (option) => `
      <button
        class="custom-select-option ${option.value === selectedValue ? 'active' : ''} ${option.dataset.styleVariant === 'danger' ? 'danger' : ''}"
        type="button"
        data-value="${escapeDropdownHtml(option.value)}"
        ${option.disabled ? 'disabled' : ''}
      >
        <span>${escapeDropdownHtml(option.textContent)}</span>
      </button>
    `
    )
    .join('');

  panel.innerHTML = `
    ${
      statusLabel
        ? `
      <div class="custom-select-status ${isLoading ? 'is-loading' : ''}">
        <span class="custom-select-status-spinner" aria-hidden="true"></span>
        <span>${escapeDropdownHtml(statusLabel)}</span>
      </div>
    `
        : ''
    }
    ${optionsMarkup}
  `;

  dropdown.classList.toggle(
    'has-panel-options',
    Boolean(statusLabel) || options.length > 0
  );
  panel.classList.toggle(
    'has-panel-options',
    Boolean(statusLabel) || options.length > 0
  );
}

function updateDropdownPlacement(dropdown) {
  if (!dropdown?.classList.contains('custom-select')) {
    return;
  }

  const panel = getDropdownPanel(dropdown);

  if (!panel) {
    return;
  }

  panel.style.removeProperty('--custom-select-panel-max-height');
  panel.style.removeProperty('--custom-select-panel-width');
  panel.style.removeProperty('--custom-select-panel-left');
  panel.style.removeProperty('--custom-select-panel-top');
  panel.style.removeProperty('--custom-select-panel-bottom');

  const rect = dropdown.getBoundingClientRect();
  const panelHeight = Math.min(Math.max(panel.scrollHeight, 0), 240) || 180;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 12);
  const spaceAbove = Math.max(0, rect.top - 12);
  const shouldOpenUpward = spaceBelow < panelHeight && spaceAbove > spaceBelow;
  const availableHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(
    96,
    Math.min(240, Math.floor(availableHeight || panelHeight))
  );
  const panelWidth = Math.max(120, Math.round(rect.width));
  const left = Math.max(
    12,
    Math.min(rect.left, viewportWidth - panelWidth - 12)
  );

  dropdown.classList.toggle('open-upward', shouldOpenUpward);
  panel.classList.toggle('open-upward', shouldOpenUpward);
  panel.style.setProperty('--custom-select-panel-max-height', `${maxHeight}px`);
  panel.style.setProperty('--custom-select-panel-width', `${panelWidth}px`);
  panel.style.setProperty(
    '--custom-select-panel-left',
    `${Math.round(left)}px`
  );

  if (shouldOpenUpward) {
    panel.style.setProperty(
      '--custom-select-panel-bottom',
      `${Math.max(12, Math.round(viewportHeight - rect.top - 1))}px`
    );
    panel.style.removeProperty('--custom-select-panel-top');
    return;
  }

  panel.style.setProperty(
    '--custom-select-panel-top',
    `${Math.round(rect.bottom - 1)}px`
  );
  panel.style.removeProperty('--custom-select-panel-bottom');
}

function syncCustomDropdown(select) {
  const dropdown = select.nextElementSibling;

  if (!dropdown?.classList.contains('custom-select')) {
    return;
  }

  const triggerLabel = dropdown.querySelector('.custom-select-label');
  const selectedOption =
    select.options[select.selectedIndex] || select.options[0];

  if (triggerLabel) {
    triggerLabel.textContent = selectedOption?.textContent || '';
  }

  dropdown.classList.toggle('is-disabled', select.disabled);
  dropdown.classList.toggle(
    'is-loading',
    select.dataset.dropdownLoading === 'true'
  );
  buildCustomDropdownOptions(select, dropdown);
  updateDropdownPlacement(dropdown);
}

function createCustomDropdown(select) {
  const dropdown = document.createElement('div');
  const variant = getDropdownVariant(select);
  const panel = document.createElement('div');

  dropdown.className = `custom-select custom-select--${variant}`;
  dropdown.innerHTML = `
    <button class="custom-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="custom-select-label"></span>
      <span class="custom-select-spinner" aria-hidden="true"></span>
      <span class="custom-select-arrow" aria-hidden="true"></span>
    </button>
  `;

  panel.className = 'custom-select-panel';
  panel.setAttribute('role', 'listbox');
  document.body.appendChild(panel);
  dropdown._customSelectPanel = panel;

  const trigger = dropdown.querySelector('.custom-select-trigger');

  trigger.addEventListener('click', () => {
    if (select.disabled) {
      return;
    }

    const willOpen = !dropdown.classList.contains('open');

    if (willOpen) {
      select.dispatchEvent(
        new CustomEvent('custom-select:will-open', {
          detail: { dropdown }
        })
      );
      syncCustomDropdown(select);
      updateDropdownPlacement(dropdown);
    }

    if (!dropdown.classList.contains('has-panel-options')) {
      return;
    }

    closeAllCustomDropdowns(willOpen ? select : null);
    setDropdownOpen(dropdown, willOpen);
  });

  panel.addEventListener('click', (event) => {
    const optionButton = event.target.closest('.custom-select-option');

    if (!optionButton || optionButton.disabled) {
      return;
    }

    if (select.value !== optionButton.dataset.value) {
      select.value = optionButton.dataset.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    syncCustomDropdown(select);
    setDropdownOpen(dropdown, false);
  });

  panel.addEventListener(
    'wheel',
    (event) => {
      event.stopPropagation();
    },
    { passive: true }
  );

  select.classList.add('native-select-hidden');
  select.setAttribute('tabindex', '-1');
  select.insertAdjacentElement('afterend', dropdown);

  const observer = new MutationObserver(() => {
    syncCustomDropdown(select);
  });

  observer.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'label', 'selected']
  });

  select.addEventListener('change', () => syncCustomDropdown(select));
  CUSTOM_DROPDOWN_SELECTS.add(select);
  CUSTOM_DROPDOWN_STATE.set(select, { observer, panel });
  syncCustomDropdown(select);
}

function bindCustomDropdownGlobalEvents() {
  if (customDropdownGlobalEventsBound) {
    return;
  }

  document.addEventListener('click', (event) => {
    if (
      !event.target.closest('.custom-select') &&
      !event.target.closest('.custom-select-panel')
    ) {
      closeAllCustomDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllCustomDropdowns();
    }
  });

  window.addEventListener('resize', () => {
    repositionOpenCustomDropdowns();
  });

  document.addEventListener(
    'scroll',
    () => {
      repositionOpenCustomDropdowns();
    },
    true
  );

  customDropdownGlobalEventsBound = true;
}

function enhanceCustomSelects(root = document) {
  cleanupDetachedCustomSelects();
  bindCustomDropdownGlobalEvents();

  getSelectTargets(root).forEach((select) => {
    if (select.nextElementSibling?.classList.contains('custom-select')) {
      syncCustomDropdown(select);
      return;
    }

    createCustomDropdown(select);
  });
}
