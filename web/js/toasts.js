// Toast configuration and helpers

const TOAST_TYPES = {
    success: { icon: '✅', baseClass: 'toast-success' },
    error:   { icon: '❌', baseClass: 'toast-error' },
    warn:    { icon: '⚠️', baseClass: 'toast-warn' },
    pending: { icon: '⏳', baseClass: 'toast-pending' }
};

let activePendingId = null;

function showToast(type, text, options = {}) {
    const container = document.getElementById('toastContainer');
    const cfg = TOAST_TYPES[type] || TOAST_TYPES.success;
    const id = options.id || ('toast_' + Date.now());

    const defaultTimeout = type === 'pending' ? 0 : 2500;
    const timeout = typeof options.timeout === 'number'
        ? options.timeout
        : defaultTimeout;

    // update existing pending -> success/error/warn
    if (options.updatePending && activePendingId) {
        const old = document.getElementById(activePendingId);
        if (old) {
            old.querySelector('.toast-icon').textContent = cfg.icon;
            old.querySelector('.toast-text').textContent = text;

            old.className = 'toast ' + cfg.baseClass;
            if (type === 'error') {
                old.classList.add('toast-error-start');
            } else if (type === 'success') {
                old.classList.add('toast-success-start');
            } else if (type === 'warn') {
                old.classList.add('toast-warn-start');
            }

            setTimeout(() => {
                old.classList.remove('toast-error-start', 'toast-success-start', 'toast-warn-start');
            }, 300);

            activePendingId = null;

            if (timeout) {
                autoHideToast(old, timeout);
            }
            return id;
        }
    }

    // new toast
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `toast ${cfg.baseClass}`;
    toast.innerHTML = `
        <div class="toast-icon">${cfg.icon}</div>
        <div class="toast-text">${text}</div>
        ${
            (type === 'success' || type === 'pending')
            ? ''
            : '<div class="toast-close">×</div>'
        }
    `;

    const closeEl = toast.querySelector('.toast-close');
    if (closeEl) closeEl.onclick = () => hideToast(toast);

    container.appendChild(toast);

    if (type === 'error') {
        toast.classList.add('toast-error-start');
    } else if (type === 'success') {
        toast.classList.add('toast-success-start');
    } else if (type === 'warn') {
        toast.classList.add('toast-warn-start');
    }

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.classList.remove('toast-error-start', 'toast-success-start', 'toast-warn-start');
    }, 300);

    let hover = false;
    toast.addEventListener('mouseenter', () => hover = true);
    toast.addEventListener('mouseleave', () => {
        hover = false;
        if (!timeout) return;
        autoHideToast(toast, 2000);
    });

    if (type === 'pending') {
        activePendingId = id;
    } else if (timeout) {
        autoHideToast(toast, timeout);
    }

    return id;
}

function autoHideToast(el, ms) {
    if (!ms) return;
    setTimeout(() => {
        if (el.matches(':hover')) return;
        hideToast(el);
    }, ms);
}

function hideToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 200);
}
