const STATIC_APPLICATIONS = Object.freeze([
  { name: 'Chrome', process: 'chrome.exe', volume: 100, muted: false },
  { name: 'Spotify', process: 'spotify.exe', volume: 100, muted: false },
  { name: 'Discord', process: 'discord.exe', volume: 100, muted: false },
  { name: 'OBS Studio', process: 'obs64.exe', volume: 100, muted: false },
  { name: 'VLC', process: 'vlc.exe', volume: 100, muted: false }
]);

const { AudioSessionBridge } = require('./audio-sessions');
const { ProcessCatalog } = require('./processes');

function clampVolume(volume) {
  const numericVolume = Number(volume);
  const clampedVolume = Math.max(
    0,
    Math.min(100, Number.isFinite(numericVolume) ? numericVolume : 0)
  );
  return Math.round(clampedVolume * 1000) / 1000;
}

class AudioManager {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
    this._masterVolume = 100;
    this._muted = false;
    this._applicationStates = new Map();
    this._audioSessions = new AudioSessionBridge(this._log);
    this._processCatalog = new ProcessCatalog(this._log);
    void this._audioSessions.prewarm?.();
  }

  getApplicationState(processName) {
    if (!this._applicationStates.has(processName)) {
      this._applicationStates.set(processName, {
        volume: 100,
        muted: false,
        peak: 0
      });
    }

    return this._applicationStates.get(processName);
  }

  rememberApplicationState(processName, state) {
    const rememberedState = this.getApplicationState(processName);
    rememberedState.volume = clampVolume(state.volume);
    rememberedState.muted = Boolean(state.muted);
    rememberedState.peak = Math.max(
      0,
      Math.min(1, Number(state?.peak ?? state?.peakLevel) || 0)
    );
    return rememberedState;
  }

  buildMasterApplication() {
    return {
      name: 'System volume',
      process: 'master',
      processName: 'master',
      path: '',
      mainWindowTitle: '',
      hasWindow: false,
      instanceCount: 1,
      volume: this._muted ? 0 : this._masterVolume,
      muted: this._muted,
      peak: 0,
      peakLevel: 0
    };
  }

  withDetectedOrRememberedState(application, detectedState) {
    if (detectedState) {
      this.rememberApplicationState(application.process, detectedState);

      return {
        ...application,
        volume: detectedState.muted ? 0 : detectedState.volume,
        muted: detectedState.muted,
        peak: Math.max(
          0,
          Math.min(
            1,
            Number(detectedState?.peak ?? detectedState?.peakLevel) || 0
          )
        ),
        peakLevel: Math.max(
          0,
          Math.min(
            1,
            Number(detectedState?.peak ?? detectedState?.peakLevel) || 0
          )
        ),
        hasAudioSession: true,
        sessionCount: detectedState.sessionCount ?? 1
      };
    }

    const rememberedState = this.getApplicationState(application.process);

    return {
      ...application,
      volume: rememberedState.muted ? 0 : rememberedState.volume,
      muted: rememberedState.muted,
      peak: Math.max(0, Math.min(1, Number(rememberedState?.peak) || 0)),
      peakLevel: Math.max(0, Math.min(1, Number(rememberedState?.peak) || 0)),
      hasAudioSession: false,
      sessionCount: 0
    };
  }

  withApplicationState(application) {
    const state = this.getApplicationState(application.process);

    return {
      ...application,
      volume: state.muted ? 0 : state.volume,
      muted: state.muted,
      peak: Math.max(0, Math.min(1, Number(state?.peak) || 0)),
      peakLevel: Math.max(0, Math.min(1, Number(state?.peak) || 0))
    };
  }

  async getDetectedSessionStateMap(processNames = []) {
    const applications = await this._audioSessions.listSessions(processNames);
    return new Map(
      applications.map((application) => [
        application.process.toLowerCase(),
        application
      ])
    );
  }

  async listRunningApplications() {
    const [detectedApplications, detectedSessionStateMap] = await Promise.all([
      this._processCatalog.listRunningApplications(),
      this.getDetectedSessionStateMap()
    ]);

    return detectedApplications.map((application) =>
      this.withDetectedOrRememberedState(
        application,
        detectedSessionStateMap.get(application.process.toLowerCase())
      )
    );
  }

  async listApplications() {
    const runningApplications =
      await this._processCatalog.listRunningApplications();
    const visibleApplications = runningApplications.length
      ? runningApplications.map((application) =>
          this.withApplicationState(application)
        )
      : STATIC_APPLICATIONS.map((application) =>
          this.withApplicationState(application)
        );
    const applications = [
      this.buildMasterApplication(),
      ...visibleApplications
    ];

    return { applications };
  }

  setVolume(processName, volume) {
    this._log('set_volume', processName, volume);

    if (processName === 'master') {
      this._masterVolume = clampVolume(volume);
      this._muted = this._masterVolume === 0;
      return {
        success: true,
        volume: this._masterVolume,
        process: processName,
        muted: this._muted
      };
    }

    const nextVolume = clampVolume(volume);
    const nextMuted = nextVolume === 0;
    const state = this.rememberApplicationState(processName, {
      volume: nextVolume,
      muted: nextMuted
    });

    return this._audioSessions
      .setVolume(processName, nextVolume)
      .then((result) => {
        const detectedState = result?.application || null;
        const hasAudioSession =
          Boolean(detectedState) || Number(result?.updatedCount) > 0;

        if (detectedState) {
          this.rememberApplicationState(processName, detectedState);
        }

        return {
          success: true,
          volume: detectedState?.muted
            ? 0
            : (detectedState?.volume ?? state.volume),
          process: processName,
          muted: detectedState?.muted ?? state.muted,
          updatedCount: result?.updatedCount ?? 0,
          hasAudioSession
        };
      });
  }

  toggleMute(processName) {
    this._log('toggle_mute', processName);

    if (processName === 'master') {
      this._muted = !this._muted;
      return { success: true, muted: this._muted, process: processName };
    }

    const state = this.getApplicationState(processName);
    const nextMuted = !state.muted;

    this.rememberApplicationState(processName, {
      volume: state.volume,
      muted: nextMuted
    });

    return this._audioSessions
      .setMute(processName, nextMuted)
      .then((result) => {
        const detectedState = result?.application || null;
        const hasAudioSession =
          Boolean(detectedState) || Number(result?.updatedCount) > 0;

        if (detectedState) {
          this.rememberApplicationState(processName, detectedState);
        }

        return {
          success: true,
          muted: detectedState?.muted ?? nextMuted,
          process: processName,
          updatedCount: result?.updatedCount ?? 0,
          hasAudioSession
        };
      });
  }

  setMute(processName, muted) {
    this._log('set_mute', processName, muted);

    if (processName === 'master') {
      this._muted = Boolean(muted);
      return {
        success: true,
        muted: this._muted,
        process: processName,
        volume: this._muted ? 0 : this._masterVolume
      };
    }

    const state = this.getApplicationState(processName);
    const nextMuted = Boolean(muted);

    this.rememberApplicationState(processName, {
      volume: state.volume,
      muted: nextMuted
    });

    return this._audioSessions
      .setMute(processName, nextMuted)
      .then((result) => {
        const detectedState = result?.application || null;
        const hasAudioSession =
          Boolean(detectedState) || Number(result?.updatedCount) > 0;

        if (detectedState) {
          this.rememberApplicationState(processName, detectedState);
        }

        return {
          success: true,
          muted: detectedState?.muted ?? nextMuted,
          process: processName,
          volume: detectedState?.muted
            ? 0
            : (detectedState?.volume ?? state.volume),
          updatedCount: result?.updatedCount ?? 0,
          hasAudioSession
        };
      });
  }

  async getApplicationCatalog() {
    const applications = await this.listRunningApplications();

    return {
      success: true,
      applications,
      fetchedAt: new Date().toISOString(),
      fallbackUsed: false
    };
  }

  async getAudioStates(processNames = []) {
    const trackedProcessNames = Array.isArray(processNames)
      ? [...new Set(processNames.filter(Boolean))]
      : [];
    const detectedSessionStateMap = await this.getDetectedSessionStateMap(
      trackedProcessNames.filter((processName) => processName !== 'master')
    );
    const applications = trackedProcessNames.map((processName) => {
      if (processName === 'master') {
        return this.buildMasterApplication();
      }

      const detectedState = detectedSessionStateMap.get(
        processName.toLowerCase()
      );

      if (detectedState) {
        this.rememberApplicationState(processName, detectedState);

        return {
          process: processName,
          volume: detectedState.muted ? 0 : detectedState.volume,
          muted: detectedState.muted,
          peak: Math.max(
            0,
            Math.min(
              1,
              Number(detectedState?.peak ?? detectedState?.peakLevel) || 0
            )
          ),
          peakLevel: Math.max(
            0,
            Math.min(
              1,
              Number(detectedState?.peak ?? detectedState?.peakLevel) || 0
            )
          ),
          hasAudioSession: true,
          sessionCount: detectedState.sessionCount ?? 1
        };
      }

      const rememberedState = this.getApplicationState(processName);

      return {
        process: processName,
        volume: rememberedState.muted ? 0 : rememberedState.volume,
        muted: rememberedState.muted,
        peak: Math.max(0, Math.min(1, Number(rememberedState?.peak) || 0)),
        peakLevel: Math.max(0, Math.min(1, Number(rememberedState?.peak) || 0)),
        hasAudioSession: false,
        sessionCount: 0
      };
    });

    return {
      success: true,
      applications
    };
  }

  shutdown() {
    this._audioSessions.shutdown();
  }

  list_applications() {
    return this.listApplications();
  }

  set_volume(processName, volume) {
    return this.setVolume(processName, volume);
  }

  toggle_mute(processName) {
    return this.toggleMute(processName);
  }

  set_mute(processName, muted) {
    return this.setMute(processName, muted);
  }

  get_application_catalog() {
    return this.getApplicationCatalog();
  }

  get_audio_states(processNames) {
    return this.getAudioStates(processNames);
  }
}

module.exports = { AudioManager };
