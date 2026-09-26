import { coreFeatureScripts } from './core/manifest.js';
import { profilesFeatureScripts } from './profiles/manifest.js';
import { settingsFeatureScripts } from './settings/manifest.js';
import { channelsFeatureScripts } from './channels/manifest.js';
import { midiFeatureScripts } from './midi/manifest.js';
import { editorFeatureScripts } from './editor/manifest.js';
import { shellFeatureScripts } from './shell/manifest.js';

export const rendererFeaturePlan = Object.freeze([
  {
    name: 'core',
    scripts: coreFeatureScripts
  },
  {
    name: 'profiles',
    scripts: profilesFeatureScripts
  },
  {
    name: 'settings',
    scripts: settingsFeatureScripts
  },
  {
    name: 'channels',
    scripts: channelsFeatureScripts
  },
  {
    name: 'midi',
    scripts: midiFeatureScripts
  },
  {
    name: 'editor',
    scripts: editorFeatureScripts
  },
  {
    name: 'shell',
    scripts: shellFeatureScripts
  }
]);

export const rendererScriptPlan = Object.freeze(
  rendererFeaturePlan.flatMap((feature) => feature.scripts)
);
