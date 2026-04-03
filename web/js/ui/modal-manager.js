(function initModalManager(globalScope) {
  const registry = new Map();
  let activeModalId = null;

  function resolveElement(reference) {
    if (!reference) {
      return null;
    }

    if (reference instanceof HTMLElement) {
      return reference;
    }

    return document.getElementById(reference);
  }

  function getEntry(modalId) {
    return registry.get(modalId) || null;
  }

  function getActiveEntry() {
    return activeModalId ? getEntry(activeModalId) : null;
  }

  function focusModal(entry) {
    if (!entry?.element) {
      return;
    }

    const focusSelector = entry.options.initialFocusSelector
      || '[autofocus], input, button, select, textarea, [tabindex]:not([tabindex="-1"])';
    const target = entry.element.querySelector(focusSelector) || entry.content || entry.element;

    if (typeof target?.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  }

  function syncBodyState() {
    document.body.classList.toggle('modal-open', Boolean(activeModalId));
  }

  function closeModal(modalId = activeModalId, meta = {}) {
    const entry = getEntry(modalId);

    if (!entry || !entry.element.classList.contains('active')) {
      return false;
    }

    const { onClose } = entry.options;
    const payload = entry.state.payload;
    const opener = entry.state.opener;

    entry.element.classList.remove('active');
    entry.element.setAttribute('aria-hidden', 'true');
    entry.state.payload = null;
    entry.state.opener = null;

    if (activeModalId === entry.id) {
      activeModalId = null;
    }

    syncBodyState();
    onClose?.(payload, meta, entry);

    if (opener && opener.isConnected && typeof opener.focus === 'function') {
      requestAnimationFrame(() => {
        opener.focus({ preventScroll: true });
      });
    }

    return true;
  }

  function openModal(modalId, payload = null, meta = {}) {
    const entry = getEntry(modalId);

    if (!entry) {
      console.warn(`Modal "${modalId}" is not registered`);
      return false;
    }

    if (activeModalId && activeModalId !== modalId) {
      closeModal(activeModalId, { reason: 'switch', nextModalId: modalId });
    }

    entry.state.payload = payload;
    entry.state.opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    entry.options.onOpen?.(payload, meta, entry);
    entry.element.classList.add('active');
    entry.element.setAttribute('aria-hidden', 'false');
    activeModalId = entry.id;
    syncBodyState();

    requestAnimationFrame(() => {
      if (activeModalId === entry.id) {
        focusModal(entry);
      }
    });

    return true;
  }

  function closeActiveModal(meta = {}) {
    return closeModal(activeModalId, meta);
  }

  function bindEntry(entry) {
    if (entry.element.dataset.modalManagerBound === 'true') {
      return;
    }

    entry.element.dataset.modalManagerBound = 'true';
    entry.element.setAttribute('aria-hidden', entry.element.classList.contains('active') ? 'false' : 'true');

    entry.element.addEventListener('click', (event) => {
      const closeTrigger = event.target.closest('[data-modal-close]');

      if (closeTrigger && entry.element.contains(closeTrigger)) {
        event.preventDefault();
        closeModal(entry.id, { reason: 'action' });
        return;
      }

      if (event.target === entry.element && entry.options.closeOnOverlay !== false) {
        closeModal(entry.id, { reason: 'overlay' });
      }
    });
  }

  function registerModal(modalId, options = {}) {
    const element = resolveElement(options.element || options.elementId || modalId);

    if (!element) {
      console.warn(`Modal element for "${modalId}" was not found`);
      return null;
    }

    const entry = {
      id: modalId,
      element,
      content: element.querySelector('.modal-content'),
      options,
      state: {
        payload: null,
        opener: null
      }
    };

    registry.set(modalId, entry);
    bindEntry(entry);
    return entry;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    const activeEntry = getActiveEntry();

    if (!activeEntry || activeEntry.options.closeOnEscape === false) {
      return;
    }

    event.preventDefault();
    closeModal(activeEntry.id, { reason: 'escape' });
  });

  globalScope.modalManager = {
    register: registerModal,
    open: openModal,
    close: closeModal,
    closeActive: closeActiveModal,
    getActiveModalId: () => activeModalId,
    getRegisteredModal: getEntry
  };

  globalScope.registerModal = registerModal;
  globalScope.openModal = openModal;
  globalScope.closeModal = closeModal;
  globalScope.closeActiveModal = closeActiveModal;
})(window);
