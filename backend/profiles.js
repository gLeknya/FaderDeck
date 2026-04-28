const fs = require('fs');
const path = require('path');
const { validateProfileData } = require('./profile-schema');

const PROFILE_VERSION = 1;
const DEFAULT_CHANNEL_TITLE_PREFIX = 'Channel';
// eslint-disable-next-line no-control-regex
const INVALID_PROFILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;

function createChannelTemplate(index = 1) {
  return {
    id: Date.now() + index,
    app: 'master',
    appName: 'System volume',
    title: `${DEFAULT_CHANNEL_TITLE_PREFIX} ${index}`,
    faderCC: null,
    faderMapping: null,
    volume: 100,
    buttons: [],
    skipBinding: false,
    showBindHint: true,
    flashOnCreate: false
  };
}

class ProfileManager {
  constructor(baseDir, logFunction) {
    this.baseDir = baseDir;
    this._log = logFunction || (() => {});
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  normalizeProfileName(name = '') {
    return String(name)
      .replace(INVALID_PROFILE_NAME_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getSafeProfileName(name = '', fallback = 'Profile') {
    return this.normalizeProfileName(name) || fallback;
  }

  getUniqueProfileName(name = '', { excludeName = '' } = {}) {
    const baseName = this.getSafeProfileName(name);
    const normalizedExclude = this.normalizeProfileName(excludeName);

    if (
      baseName === normalizedExclude ||
      !fs.existsSync(this.getProfilePath(baseName))
    ) {
      return baseName;
    }

    let index = 2;

    while (true) {
      const candidate = `${baseName} ${index}`;

      if (
        candidate === normalizedExclude ||
        !fs.existsSync(this.getProfilePath(candidate))
      ) {
        return candidate;
      }

      index += 1;
    }
  }

  createProfileTemplate({ name = '', channelCount = 0 } = {}) {
    const timestamp = new Date().toISOString();

    return {
      version: PROFILE_VERSION,
      meta: {
        name,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      channels: Array.from({ length: channelCount }, (_unused, index) =>
        createChannelTemplate(index + 1)
      ),
      standaloneButtons: [],
      bindings: {
        faders: [],
        buttons: []
      },
      audio: {
        assignments: []
      },
      settings: {
        midiInputId: null
      }
    };
  }

  getProfilePath(name) {
    return path.join(this.baseDir, `${this.getSafeProfileName(name)}.json`);
  }

  handleError(action, error) {
    this._log(`${action} error:`, error);
    return { success: false, error: String(error) };
  }

  validateProfile(profile, action = 'profile') {
    const validation = validateProfileData(profile);

    if (!validation.success) {
      throw new Error(`Invalid ${action}: ${validation.error}`);
    }

    return validation.data;
  }

  normalizeProfile(profile = {}, { name = '' } = {}) {
    const validatedProfile = this.validateProfile(profile, 'profile');
    const template = this.createProfileTemplate({ name });
    const channels = Array.isArray(validatedProfile.channels)
      ? validatedProfile.channels
      : template.channels;
    const standaloneButtons = Array.isArray(validatedProfile.standaloneButtons)
      ? validatedProfile.standaloneButtons
      : template.standaloneButtons;
    const existingMeta =
      validatedProfile.meta && typeof validatedProfile.meta === 'object'
        ? validatedProfile.meta
        : {};
    const createdAt = existingMeta.createdAt || template.meta.createdAt;

    return {
      ...template,
      ...validatedProfile,
      version: PROFILE_VERSION,
      meta: {
        ...template.meta,
        ...existingMeta,
        name: existingMeta.name || name || template.meta.name,
        createdAt,
        updatedAt: new Date().toISOString()
      },
      channels,
      standaloneButtons,
      bindings: {
        ...template.bindings,
        ...(validatedProfile.bindings &&
        typeof validatedProfile.bindings === 'object'
          ? validatedProfile.bindings
          : {}),
        faders: channels
          .filter(
            (channel) => channel?.faderMapping || channel?.faderCC != null
          )
          .map((channel) => ({
            channelId: channel.id ?? null,
            process: channel.app ?? 'master',
            appName: channel.appName ?? 'System volume',
            title: channel.title ?? '',
            faderCC: channel.faderCC ?? null,
            faderMapping: channel.faderMapping ?? null
          }))
      },
      audio: {
        ...template.audio,
        ...(validatedProfile.audio && typeof validatedProfile.audio === 'object'
          ? validatedProfile.audio
          : {}),
        assignments: channels.map((channel) => ({
          channelId: channel.id ?? null,
          process: channel.app ?? 'master',
          appName: channel.appName ?? 'System volume',
          title: channel.title ?? '',
          targetType: channel.app === 'master' ? 'master' : 'application'
        }))
      },
      settings: {
        ...template.settings,
        ...(validatedProfile.settings &&
        typeof validatedProfile.settings === 'object'
          ? validatedProfile.settings
          : {})
      }
    };
  }

  save(name, data) {
    try {
      const safeName = this.getSafeProfileName(name);
      const profilePath = this.getProfilePath(safeName);
      const normalizedProfile = this.normalizeProfile(data, { name: safeName });

      fs.writeFileSync(
        profilePath,
        JSON.stringify(normalizedProfile, null, 2),
        'utf-8'
      );
      this._log('save_profile', safeName, '->', profilePath);

      return { success: true, name: safeName, path: profilePath };
    } catch (error) {
      return this.handleError('save_profile', error);
    }
  }

  load(name) {
    try {
      const safeName = this.getSafeProfileName(name);
      const profilePath = this.getProfilePath(safeName);

      if (!fs.existsSync(profilePath)) {
        return { success: false, error: 'Profile not found' };
      }

      const data = this.normalizeProfile(
        JSON.parse(fs.readFileSync(profilePath, 'utf-8')),
        {
          name: safeName
        }
      );
      this._log('load_profile', safeName);

      return { success: true, data };
    } catch (error) {
      return this.handleError('load_profile', error);
    }
  }

  listProfiles() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        return { success: true, profiles: [] };
      }

      const profiles = fs
        .readdirSync(this.baseDir)
        .filter((fileName) => fileName.endsWith('.json'))
        .map((fileName) => {
          const profilePath = path.join(this.baseDir, fileName);
          const stats = fs.statSync(profilePath);
          let meta = {};

          try {
            meta =
              this.validateProfile(
                JSON.parse(fs.readFileSync(profilePath, 'utf-8')),
                `profile "${fileName}"`
              )?.meta || {};
          } catch (error) {
            this._log('list_profiles meta read error:', profilePath, error);
          }

          return {
            name: path.basename(fileName, '.json'),
            path: profilePath,
            modified: stats.mtimeMs,
            meta
          };
        });

      this._log('list_profiles:', profiles);

      return { success: true, profiles };
    } catch (error) {
      return this.handleError('list_profiles', error);
    }
  }

  deleteProfile(name) {
    try {
      const safeName = this.getSafeProfileName(name);
      const profilePath = this.getProfilePath(safeName);

      if (fs.existsSync(profilePath)) {
        fs.unlinkSync(profilePath);
      }

      this._log('delete_profile', safeName);

      return { success: true };
    } catch (error) {
      return this.handleError('delete_profile', error);
    }
  }

  renameProfile(fromName, toName) {
    try {
      const sourceName = this.getSafeProfileName(fromName);
      const targetName = this.getSafeProfileName(toName);
      const sourcePath = this.getProfilePath(sourceName);
      const targetPath = this.getProfilePath(targetName);

      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: 'Profile not found' };
      }

      if (sourceName !== targetName && fs.existsSync(targetPath)) {
        return { success: false, error: 'Profile already exists' };
      }

      const profile = this.normalizeProfile(
        JSON.parse(fs.readFileSync(sourcePath, 'utf-8')),
        { name: targetName }
      );

      fs.writeFileSync(targetPath, JSON.stringify(profile, null, 2), 'utf-8');

      if (sourcePath !== targetPath && fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath);
      }

      this._log('rename_profile', sourceName, '->', targetName);
      return { success: true, name: targetName, path: targetPath };
    } catch (error) {
      return this.handleError('rename_profile', error);
    }
  }

  importProfile(filePath, options = {}) {
    try {
      const imported = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const suggestedName =
        options.name ||
        imported?.meta?.name ||
        path.basename(filePath, path.extname(filePath));
      const safeName = this.getUniqueProfileName(suggestedName);

      return this.save(safeName, imported);
    } catch (error) {
      return this.handleError('import_profile', error);
    }
  }

  getProfilesDirectory() {
    return this.baseDir;
  }

  save_profile(name, data) {
    return this.save(name, data);
  }

  getProfileTemplate(options) {
    return this.createProfileTemplate(options);
  }

  load_profile(name) {
    return this.load(name);
  }

  list_profiles() {
    return this.listProfiles();
  }

  rename_profile(fromName, toName) {
    return this.renameProfile(fromName, toName);
  }

  import_profile(filePath, options) {
    return this.importProfile(filePath, options);
  }

  delete(name) {
    return this.deleteProfile(name);
  }

  delete_profile(name) {
    return this.deleteProfile(name);
  }
}

module.exports = { ProfileManager };
