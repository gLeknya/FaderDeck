(function bootstrapRenderer() {
  const bootstrapScript = document.currentScript;
  const bootstrapBaseUrl = bootstrapScript
    ? new URL('./', bootstrapScript.src).toString()
    : new URL('./js/', window.location.href).toString();
  const rendererFeaturePlan = Object.freeze([
    {
      name: 'core',
      scripts: [
        './shared/renderer-state-model.js',
        './shared/channel-model.js',
        './adapters/api-bridge.js',
        './adapters/local-storage.js',
        './adapters/language-storage.js',
        './adapters/midi-selection-storage.js',
        './adapters/ui-preferences-storage.js',
        './adapters/profile-storage.js',
        './i18n.js',
        './toasts.js',
        './state/store.js',
        './state/layout-store.js',
        './state/app-state.js',
        './state/ui-store.js',
        './runtime/audio-runtime.js',
        './ui/modal-manager.js',
        './dropdowns.js'
      ]
    },
    {
      name: 'profiles',
      scripts: [
        './actions/profile-actions.js',
        './profiles/profile-store.js',
        './profiles/profile-service.js',
        './profiles.js'
      ]
    },
    {
      name: 'settings',
      scripts: [
        './actions/ui-actions.js'
      ]
    },
    {
      name: 'channels',
      scripts: [
        './state/channel-store.js',
        './runtime/channel-button-runtime.js',
        './actions/layout-actions.js',
        './actions/channel-actions.js',
        './channels.js',
        './buttons.js'
      ]
    },
    {
      name: 'midi',
      scripts: [
        './actions/midi-actions.js',
        './midi/midi-service.js',
        './midi-ui.js'
      ]
    },
    {
      name: 'editor',
      scripts: [
        './ui/entity-editor.js'
      ]
    },
    {
      name: 'shell',
      scripts: [
        './app.js',
        './shell/composition-root.js'
      ]
    }
  ]);

  const rendererScriptPlan = rendererFeaturePlan.flatMap((feature) => feature.scripts);

  function loadLegacyScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(path, bootstrapBaseUrl).toString();
      script.async = false;
      script.onload = () => resolve(path);
      script.onerror = () => reject(new Error(`Failed to load renderer script: ${path}`));
      document.body.appendChild(script);
    });
  }

  async function loadLegacyScriptsSequentially(paths = []) {
    for (const path of paths) {
      await loadLegacyScript(path);
    }
  }

  loadLegacyScriptsSequentially(rendererScriptPlan).catch((error) => {
    console.error('[FaderDeck] renderer bootstrap failed', error);
  });
})();
