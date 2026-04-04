(function initVolumeHudOverlay(window) {
  const dom = {};

  function $(id) {
    return document.getElementById(id);
  }

  function clampHudVolume(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function formatHudValue(payload = {}) {
    const providedValue = String(payload?.valueText || '').trim();

    if (providedValue) {
      return providedValue;
    }

    return `${Math.round(clampHudVolume(payload?.volume))}%`;
  }

  function syncVisibility(visible) {
    dom.root?.classList.toggle('is-visible', Boolean(visible));
  }

  function renderVolumeHud(payload = {}) {
    const title = String(payload?.title || '').trim() || 'Volume';
    const subtitle = String(payload?.subtitle || '').trim();
    const iconDataUrl = String(payload?.iconDataUrl || '').trim();
    const volume = clampHudVolume(payload?.volume);

    if (dom.title) {
      dom.title.textContent = title;
      dom.title.title = title;
    }

    if (dom.subtitle) {
      dom.subtitle.textContent = subtitle;
      dom.subtitle.title = subtitle;
      dom.subtitle.classList.toggle('hidden', !subtitle);
    }

    if (dom.value) {
      dom.value.textContent = formatHudValue(payload);
    }

    if (dom.fill) {
      dom.fill.style.width = `${volume}%`;
    }

    if (dom.thumb) {
      dom.thumb.style.left = `${volume}%`;
    }

    if (dom.iconShell && dom.icon) {
      const hasIcon = Boolean(iconDataUrl);
      dom.iconShell.classList.toggle('hidden', !hasIcon);

      if (hasIcon) {
        dom.icon.src = iconDataUrl;
        dom.icon.alt = title;
      } else {
        dom.icon.removeAttribute('src');
        dom.icon.alt = '';
      }
    }
  }

  function cacheDom() {
    dom.root = $('volumeHud');
    dom.iconShell = $('volumeHudIconShell');
    dom.icon = $('volumeHudIcon');
    dom.title = $('volumeHudTitle');
    dom.subtitle = $('volumeHudSubtitle');
    dom.value = $('volumeHudValue');
    dom.fill = $('volumeHudMeterFill');
    dom.thumb = $('volumeHudMeterThumb');
  }

  function init() {
    cacheDom();

    window.volumeHud?.onUpdate?.((payload) => {
      renderVolumeHud(payload);
    });

    window.volumeHud?.onVisibilityChange?.((payload) => {
      syncVisibility(Boolean(payload?.visible));
    });
  }

  window.addEventListener('DOMContentLoaded', init, { once: true });
})(window);
