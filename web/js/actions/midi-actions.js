(function initMidiActions(window) {
  function getMidiService() {
    return window.midiService || null;
  }

  function persistProfile() {
    return window.profileActions?.saveRendererProfileToLocal?.() || null;
  }

  function selectMidiInput(inputId, inputName = '', meta = {}) {
    const nextMidiState = getMidiService()?.selectInput?.(inputId, inputName, {
      source: 'midi-actions',
      ...meta
    }) || null;

    persistProfile();
    return nextMidiState;
  }

  function disableMidiInputSelection(meta = {}) {
    const disabledOptionValue = getMidiService()?.getDisabledOptionValue?.() || '__disabled__';
    return selectMidiInput(disabledOptionValue, '', {
      type: 'midi-actions/disable-selection',
      ...meta
    });
  }

  function clearMidiSelection(meta = {}) {
    return selectMidiInput('', '', {
      type: 'midi-actions/clear-selection',
      ...meta
    });
  }

  async function scanMidiInputs(meta = {}) {
    return getMidiService()?.scanInputs?.({
      source: 'midi-actions',
      ...meta
    });
  }

  async function learnChannelFaderMapping(channelId, meta = {}) {
    const channel = window.findChannelState?.(channelId);
    const midiService = getMidiService();

    if (!channel || !midiService) {
      return null;
    }

    window.showToast?.('pending', window.t?.('midi.moveFader', {
      name: channel.title || channel.appName
    }));

    if (!midiService.getSelectedInputId?.() || midiService.isDisabledSelection?.()) {
      window.showToast?.('error', window.t?.('midi.selectDeviceFirst'), { updatePending: true });
      return null;
    }

    try {
      await midiService.ensureAccess?.();
    } catch (error) {
      if (error?.code === 'midi_unsupported') {
        window.showToast?.('error', window.t?.('midi.unsupported'), { updatePending: true });
        return null;
      }

      window.showToast?.('error', window.t?.('midi.initFailed'), { updatePending: true });
      return null;
    }

    const learned = await midiService.learnFaderMapping?.();

    if (!learned) {
      window.showToast?.('error', window.t?.('midi.failedToDetect'), { updatePending: true });
      window.logTest?.('startBindFader: NO LEARNED MESSAGE');
      return null;
    }

    const conflict = midiService.findFaderMappingConflict?.(channelId, learned);

    if (conflict) {
      const conflictName = conflict.title || conflict.appName;
      const confirmed = window.confirm?.(window.t?.('midi.conflict', { name: conflictName }));

      if (!confirmed) {
        window.showToast?.('warn', window.t?.('midi.bindCancelled'), { updatePending: true });
        window.logTest?.('startBindFader: USER CANCELED ON CONFLICT');
        return null;
      }
    }

    midiService.applyChannelFaderMapping?.(channelId, learned, {
      source: 'midi-actions',
      ...meta
    });
    persistProfile();
    window.showToast?.('success', window.t?.('midi.bindSuccess'), { updatePending: true });
    return learned;
  }

  async function learnChannelButtonMapping(channelId, buttonId, meta = {}) {
    const channel = window.findChannelState?.(channelId);
    const button = channel?.buttons?.find((item) => item.id === buttonId) || null;
    const midiService = getMidiService();

    if (!channel || !button || !midiService) {
      return null;
    }

    window.showToast?.('pending', window.t?.('midi.moveButton', {
      name: button.text || window.t?.('buttons.defaultLabel') || 'Button'
    }));

    if (!midiService.getSelectedInputId?.() || midiService.isDisabledSelection?.()) {
      window.showToast?.('error', window.t?.('midi.selectDeviceFirst'), { updatePending: true });
      return null;
    }

    try {
      await midiService.ensureAccess?.();
    } catch (error) {
      if (error?.code === 'midi_unsupported') {
        window.showToast?.('error', window.t?.('midi.unsupported'), { updatePending: true });
        return null;
      }

      window.showToast?.('error', window.t?.('midi.initFailed'), { updatePending: true });
      return null;
    }

    const learned = await midiService.learnButtonMapping?.();

    if (!learned) {
      window.showToast?.('error', window.t?.('midi.failedToDetect'), { updatePending: true });
      return null;
    }

    const conflict = midiService.findButtonMappingConflict?.(channelId, buttonId, learned);

    if (conflict) {
      const conflictName = conflict.title || conflict.text || conflict.appName || conflict.process || 'Control';
      const confirmed = window.confirm?.(window.t?.('midi.buttonConflict', { name: conflictName }));

      if (!confirmed) {
        window.showToast?.('warn', window.t?.('midi.bindCancelled'), { updatePending: true });
        return null;
      }
    }

    midiService.applyChannelButtonMapping?.(channelId, buttonId, learned, {
      source: 'midi-actions',
      ...meta
    });
    persistProfile();
    midiService.flashChannelButtonBindingFeedback?.(channelId, buttonId, { reason: 'button-bind' });
    midiService.syncChannelButtonIndicators?.({ reason: 'button-bind' });
    window.showToast?.('success', window.t?.('midi.buttonBindSuccess'), { updatePending: true });
    return learned;
  }

  window.midiActions = {
    selectMidiInput,
    disableMidiInputSelection,
    clearMidiSelection,
    scanMidiInputs,
    learnChannelFaderMapping,
    learnChannelButtonMapping
  };
})(window);
