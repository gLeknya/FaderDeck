(function initVolumeHudOverlay(window) {
  const dom = {};
  let currentPresentation = {
    orientation: 'horizontal',
    showIcon: true,
    showTitle: true,
    showSubtitle: true,
    showPercent: true,
    showMeter: true
  };

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

  function toggleHidden(element, hidden) {
    element?.classList.toggle('hidden', Boolean(hidden));
  }

  function applyPresentationSettings(presentation = {}) {
    currentPresentation = {
      ...currentPresentation,
      ...(presentation || {})
    };

    if (!dom.root) {
      return;
    }

    dom.root.classList.toggle(
      'volume-hud--vertical',
      currentPresentation.orientation === 'vertical'
    );
    dom.root.classList.toggle(
      'volume-hud--horizontal',
      currentPresentation.orientation !== 'vertical'
    );
  }

  function syncVisibility(visible) {
    dom.root?.classList.toggle('is-visible', Boolean(visible));
  }

  function renderVolumeHud(payload = {}) {
    const title = String(payload?.title || '').trim() || 'Volume';
    const subtitle = String(payload?.subtitle || '').trim();
    const iconDataUrl = String(payload?.iconDataUrl || '').trim();
    const muted = Boolean(payload?.muted);
    const volume = clampHudVolume(payload?.volume);
    const presentation = payload?.presentation || {};
    const showTitle = presentation.showTitle !== false;
    const showSubtitle = presentation.showSubtitle !== false;
    const showIcon = presentation.showIcon !== false;
    const showPercent = presentation.showPercent !== false;
    const showMeter = presentation.showMeter !== false;
    const subtitleVisible = showSubtitle && Boolean(subtitle);
    const promoteSubtitle = !showTitle && subtitleVisible;

    applyPresentationSettings(presentation);
    dom.root?.classList.toggle(
      'volume-hud--subtitle-promoted',
      promoteSubtitle
    );
    dom.root?.classList.toggle('is-muted', muted);

    if (dom.title) {
      dom.title.textContent = title;
      dom.title.title = title;
      toggleHidden(dom.title, !showTitle);
    }

    if (dom.subtitle) {
      dom.subtitle.textContent = subtitle;
      dom.subtitle.title = subtitle;
      toggleHidden(dom.subtitle, !showSubtitle || !subtitle);
    }

    if (dom.value) {
      dom.value.textContent = formatHudValue(payload);
      toggleHidden(dom.value, !showPercent);
    }

    if (dom.fill) {
      if (currentPresentation.orientation === 'vertical') {
        dom.fill.style.height = `${volume}%`;
        dom.fill.style.width = '100%';
      } else {
        dom.fill.style.width = `${volume}%`;
        dom.fill.style.height = '100%';
      }
    }

    if (dom.thumb) {
      if (currentPresentation.orientation === 'vertical') {
        dom.thumb.style.bottom = `${volume}%`;
        dom.thumb.style.left = '50%';
      } else {
        dom.thumb.style.left = `${volume}%`;
        dom.thumb.style.bottom = '0';
      }
    }

    if (dom.iconShell && dom.icon) {
      const hasIcon = showIcon && Boolean(iconDataUrl);
      toggleHidden(dom.iconShell, !hasIcon);

      if (hasIcon) {
        dom.icon.src = iconDataUrl;
        dom.icon.alt = title;
      } else {
        dom.icon.removeAttribute('src');
        dom.icon.alt = '';
      }
    }

    toggleHidden(dom.muteOverlay, !muted);
    toggleHidden(dom.titles, !showTitle && (!showSubtitle || !subtitle));
    toggleHidden(dom.meta, !showPercent);
    toggleHidden(
      dom.header,
      !showTitle && (!showSubtitle || !subtitle) && !showPercent
    );
    toggleHidden(dom.meter, !showMeter);
    toggleHidden(
      dom.content,
      !showTitle && (!showSubtitle || !subtitle) && !showPercent && !showMeter
    );
  }

  function cacheDom() {
    dom.root = $('volumeHud');
    dom.iconShell = $('volumeHudIconShell');
    dom.icon = $('volumeHudIcon');
    dom.content = $('volumeHudContent');
    dom.header = $('volumeHudHeader');
    dom.titles = $('volumeHudTitles');
    dom.title = $('volumeHudTitle');
    dom.subtitle = $('volumeHudSubtitle');
    dom.meta = $('volumeHudMeta');
    dom.value = $('volumeHudValue');
    dom.muteOverlay = $('volumeHudMuteOverlay');
    dom.meter = $('volumeHudMeter');
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
