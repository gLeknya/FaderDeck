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

function setDropdownOpen(dropdown, isOpen) {
  if (!dropdown?.classList.contains('custom-select')) {
    return;
  }

  dropdown.classList.toggle('open', isOpen);
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

    CUSTOM_DROPDOWN_STATE.get(select)?.observer?.disconnect();
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

function buildCustomDropdownOptions(select, dropdown) {
  const panel = dropdown.querySelector('.custom-select-panel');
  const selectedValue = select.value;
  const statusLabel = select.dataset.dropdownStatusLabel || '';
  const isLoading = select.dataset.dropdownLoading === 'true';
  const options = Array.from(select.options).filter((option) => option.value !== '');

  const optionsMarkup = (!isLoading ? options : [])
    .map((option) => `
      <button
        class="custom-select-option ${option.value === selectedValue ? 'active' : ''} ${option.dataset.styleVariant === 'danger' ? 'danger' : ''}"
        type="button"
        data-value="${escapeDropdownHtml(option.value)}"
        ${option.disabled ? 'disabled' : ''}
      >
        <span>${escapeDropdownHtml(option.textContent)}</span>
      </button>
    `)
    .join('');

  panel.innerHTML = `
    ${statusLabel ? `
      <div class="custom-select-status ${isLoading ? 'is-loading' : ''}">
        <span class="custom-select-status-spinner" aria-hidden="true"></span>
        <span>${escapeDropdownHtml(statusLabel)}</span>
      </div>
    ` : ''}
    ${optionsMarkup}
  `;

  dropdown.classList.toggle('has-panel-options', Boolean(statusLabel) || options.length > 0);
}

function updateDropdownPlacement(dropdown) {
  if (!dropdown?.classList.contains('custom-select')) {
    return;
  }

  const panel = dropdown.querySelector('.custom-select-panel');

  if (!panel) {
    return;
  }

  dropdown.classList.remove('open-upward');
  panel.style.removeProperty('--custom-select-panel-max-height');

  const rect = dropdown.getBoundingClientRect();
  const panelHeight = Math.min(Math.max(panel.scrollHeight, 0), 240) || 180;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 12);
  const spaceAbove = Math.max(0, rect.top - 12);
  const shouldOpenUpward = spaceBelow < panelHeight && spaceAbove > spaceBelow;
  const availableHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(96, Math.min(240, Math.floor(availableHeight || panelHeight)));

  dropdown.classList.toggle('open-upward', shouldOpenUpward);
  panel.style.setProperty('--custom-select-panel-max-height', `${maxHeight}px`);
}

function syncCustomDropdown(select) {
  const dropdown = select.nextElementSibling;

  if (!dropdown?.classList.contains('custom-select')) {
    return;
  }

  const triggerLabel = dropdown.querySelector('.custom-select-label');
  const selectedOption = select.options[select.selectedIndex] || select.options[0];

  if (triggerLabel) {
    triggerLabel.textContent = selectedOption?.textContent || '';
  }

  dropdown.classList.toggle('is-disabled', select.disabled);
  dropdown.classList.toggle('is-loading', select.dataset.dropdownLoading === 'true');
  buildCustomDropdownOptions(select, dropdown);
  updateDropdownPlacement(dropdown);
}

function createCustomDropdown(select) {
  const dropdown = document.createElement('div');
  const variant = getDropdownVariant(select);

  dropdown.className = `custom-select custom-select--${variant}`;
  dropdown.innerHTML = `
    <button class="custom-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="custom-select-label"></span>
      <span class="custom-select-spinner" aria-hidden="true"></span>
      <span class="custom-select-arrow" aria-hidden="true"></span>
    </button>
    <div class="custom-select-panel" role="listbox"></div>
  `;

  const trigger = dropdown.querySelector('.custom-select-trigger');
  const panel = dropdown.querySelector('.custom-select-panel');

  trigger.addEventListener('click', () => {
    if (select.disabled) {
      return;
    }

    const willOpen = !dropdown.classList.contains('open');

    if (willOpen) {
      select.dispatchEvent(new CustomEvent('custom-select:will-open', {
        detail: { dropdown }
      }));
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

  panel.addEventListener('wheel', (event) => {
    event.stopPropagation();
  }, { passive: true });

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
  CUSTOM_DROPDOWN_STATE.set(select, { observer });
  syncCustomDropdown(select);
}

function bindCustomDropdownGlobalEvents() {
  if (customDropdownGlobalEventsBound) {
    return;
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.custom-select')) {
      closeAllCustomDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllCustomDropdowns();
    }
  });

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
