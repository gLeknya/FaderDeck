const TOAST_TYPES = {
  success: { icon: 'OK', baseClass: 'toast-success' },
  error: { icon: 'ERR', baseClass: 'toast-error' },
  warn: { icon: 'WARN', baseClass: 'toast-warn' },
  pending: { icon: '...', baseClass: 'toast-pending' }
};

let activePendingId = null;

function addToastPulseClass(toast, type) {
  if (type === 'error') {
    toast.classList.add('toast-error-start');
  } else if (type === 'success') {
    toast.classList.add('toast-success-start');
  } else if (type === 'warn') {
    toast.classList.add('toast-warn-start');
  }

  setTimeout(() => {
    toast.classList.remove('toast-error-start', 'toast-success-start', 'toast-warn-start');
  }, 300);
}

function updatePendingToast(toast, type, text, timeout) {
  const config = TOAST_TYPES[type] || TOAST_TYPES.success;
  const icon = toast.querySelector('.toast-icon');
  const content = toast.querySelector('.toast-text');

  if (icon) {
    icon.textContent = config.icon;
  }

  if (content) {
    content.textContent = text;
  }

  toast.className = `toast ${config.baseClass}`;
  addToastPulseClass(toast, type);
  activePendingId = null;

  if (timeout) {
    autoHideToast(toast, timeout);
  }
}

function createToast(type, text, id) {
  const config = TOAST_TYPES[type] || TOAST_TYPES.success;
  const toast = document.createElement('div');

  toast.id = id;
  toast.className = `toast ${config.baseClass}`;
  toast.innerHTML = `
    <div class="toast-icon">${config.icon}</div>
    <div class="toast-text">${text}</div>
    ${(type === 'success' || type === 'pending') ? '' : '<div class="toast-close">x</div>'}
  `;

  const closeElement = toast.querySelector('.toast-close');

  if (closeElement) {
    closeElement.onclick = () => hideToast(toast);
  }

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
  const timeout = typeof options.timeout === 'number'
    ? options.timeout
    : (type === 'pending' ? 0 : 2500);

  if (options.updatePending && activePendingId) {
    const existingToast = document.getElementById(activePendingId);

    if (existingToast) {
      updatePendingToast(existingToast, type, text, timeout);
      return id;
    }
  }

  const toast = createToast(type, text, id);
  container.appendChild(toast);

  if (type === 'pending') {
    activePendingId = id;
  } else if (timeout) {
    autoHideToast(toast, timeout);
  }

  return id;
}

function autoHideToast(toast, delayMs) {
  if (!delayMs) {
    return;
  }

  window.setTimeout(() => {
    if (toast.matches(':hover')) {
      return;
    }

    hideToast(toast);
  }, delayMs);
}

function hideToast(toast) {
  if (!toast?.parentElement) {
    return;
  }

  if (activePendingId === toast.id) {
    activePendingId = null;
  }

  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-10px)';

  window.setTimeout(() => {
    toast.remove();
  }, 200);
}
