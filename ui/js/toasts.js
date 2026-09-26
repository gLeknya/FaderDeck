const TOAST_TYPES = {
  success: { icon: '✓', baseClass: 'toast-success' },
  error: { icon: '!', baseClass: 'toast-error' },
  warn: { icon: '?', baseClass: 'toast-warn' },
  pending: { icon: '…', baseClass: 'toast-pending' }
};

let activePendingId = null;

function escapeToastText(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addToastPulseClass(toast, type) {
  if (type === 'error') {
    toast.classList.add('toast-error-start');
  } else if (type === 'success') {
    toast.classList.add('toast-success-start');
  } else if (type === 'warn') {
    toast.classList.add('toast-warn-start');
  }

  setTimeout(() => {
    toast.classList.remove(
      'toast-error-start',
      'toast-success-start',
      'toast-warn-start'
    );
  }, 300);
}

function buildToastMarkup(type, text, options = {}) {
  const config = TOAST_TYPES[type] || TOAST_TYPES.success;
  const actions = Array.isArray(options.actions)
    ? options.actions.filter(Boolean)
    : [];
  const closeable =
    options.closeable !== false &&
    (actions.length > 0 || (type !== 'success' && type !== 'pending'));
  const iconMarkup = escapeToastText(options.icon || config.icon);
  const actionsMarkup = actions.length
    ? `
      <div class="toast-actions">
        ${actions
          .map(
            (action, index) => `
          <button
            type="button"
            class="toast-action${action?.primary ? ' is-primary' : ''}"
            data-toast-action-index="${index}"
          >${escapeToastText(action?.label || action?.value || '')}</button>
        `
          )
          .join('')}
      </div>
    `
    : '';

  return `
    <div class="toast-icon" aria-hidden="true">${iconMarkup}</div>
    <div class="toast-body">
      <div class="toast-text">${escapeToastText(text)}</div>
      ${actionsMarkup}
    </div>
    ${
      closeable
        ? '<button type="button" class="toast-close" aria-label="Close">×</button>'
        : ''
    }
  `;
}

function bindToastEvents(toast, options = {}) {
  const actions = Array.isArray(options.actions)
    ? options.actions.filter(Boolean)
    : [];
  const closeElement = toast.querySelector('.toast-close');

  toast.__toastCloseHandler =
    typeof options.onClose === 'function' ? options.onClose : null;

  if (closeElement) {
    closeElement.onclick = () => hideToast(toast, 'close');
  }

  actions.forEach((action, index) => {
    const button = toast.querySelector(`[data-toast-action-index="${index}"]`);

    if (!button) {
      return;
    }

    button.onclick = () => {
      try {
        action?.onClick?.(toast, action);
      } finally {
        if (action?.autoClose !== false) {
          hideToast(toast, 'action');
        }
      }
    };
  });
}

function renderToast(toast, type, text, options = {}) {
  const config = TOAST_TYPES[type] || TOAST_TYPES.success;
  const actions = Array.isArray(options.actions)
    ? options.actions.filter(Boolean)
    : [];

  toast.className = `toast ${config.baseClass}${actions.length ? ' toast--has-actions' : ''}`;
  toast.innerHTML = buildToastMarkup(type, text, options);
  bindToastEvents(toast, options);
}

function updateToast(toast, type, text, options = {}) {
  renderToast(toast, type, text, options);
  addToastPulseClass(toast, type);
  toast.dataset.pendingChain = 'true';
  activePendingId = toast.id;

  const timeout =
    typeof options.timeout === 'number'
      ? options.timeout
      : type === 'pending'
        ? 0
        : 2500;

  if (timeout) {
    autoHideToast(toast, timeout);
  }
}

function createToast(type, text, id, options = {}) {
  const toast = document.createElement('div');

  toast.id = id;
  renderToast(toast, type, text, options);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  addToastPulseClass(toast, type);
  return toast;
}

function showToast(type, text, options = {}) {
  const container = document.getElementById('toastContainer');

  if (!container) {
    return null;
  }

  const id = options.id || `toast_${Date.now()}`;
  const timeout =
    typeof options.timeout === 'number'
      ? options.timeout
      : type === 'pending'
        ? 0
        : 2500;

  if (options.updatePending && activePendingId) {
    const existingToast = document.getElementById(activePendingId);

    if (existingToast) {
      updateToast(existingToast, type, text, options);
      return existingToast.id;
    }
  }

  const toast = createToast(type, text, id, options);
  container.appendChild(toast);

  if (type === 'pending') {
    toast.dataset.pendingChain = 'true';
    activePendingId = id;
  } else {
    toast.dataset.pendingChain = 'false';
  }

  if (timeout) {
    autoHideToast(toast, timeout);
  }

  return id;
}

function showChoiceToast(type, text, options = {}) {
  return new Promise((resolve) => {
    let settled = false;

    function settle(value) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    }

    const actions = (Array.isArray(options.actions) ? options.actions : []).map(
      (action) => ({
        ...action,
        onClick: (toast, actionConfig) => {
          try {
            action?.onClick?.(toast, actionConfig);
          } finally {
            settle(action?.value);
          }
        }
      })
    );

    showToast(type, text, {
      ...options,
      timeout: 0,
      actions,
      onClose: (reason, toast) => {
        if (reason !== 'action') {
          settle(options.defaultValue ?? null);
        }

        options.onClose?.(reason, toast);
      }
    });
  });
}

function autoHideToast(toast, delayMs) {
  if (!delayMs) {
    return;
  }

  window.setTimeout(() => {
    if (!toast?.parentElement || toast.matches(':hover')) {
      return;
    }

    hideToast(toast, 'timeout');
  }, delayMs);
}

function hideToast(toast, reason = 'dismiss') {
  if (!toast?.parentElement || toast.__toastClosing) {
    return;
  }

  toast.__toastClosing = true;

  if (activePendingId === toast.id) {
    activePendingId = null;
  }

  const onClose = toast.__toastCloseHandler;
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-10px)';

  window.setTimeout(() => {
    try {
      onClose?.(reason, toast);
    } finally {
      toast.remove();
    }
  }, 200);
}

window.showToast = showToast;
window.showChoiceToast = showChoiceToast;
window.hideToast = hideToast;
