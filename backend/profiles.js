// backend/profiles.js
const fs = require('fs');
const path = require('path');

class ProfileManager {
  constructor(base_dir, log_func) {
    this.base_dir = base_dir;
    this._log = log_func || (() => {});
    fs.mkdirSync(this.base_dir, { recursive: true });
  }

  save(name, data) {
    try {
      const p = path.join(this.base_dir, `${name}.json`);
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
      this._log('save_profile', name, '->', p);
      return { success: true, path: p };
    } catch (e) {
      this._log('save_profile error:', e);
      return { success: false, error: String(e) };
    }
  }

  load(name) {
    try {
      const p = path.join(this.base_dir, `${name}.json`);
      if (!fs.existsSync(p)) {
        return { success: false, error: 'Profile not found' };
      }
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      this._log('load_profile', name);
      return { success: true, data };
    } catch (e) {
      this._log('load_profile error:', e);
      return { success: false, error: String(e) };
    }
  }

  list_profiles() {
    try {
      if (!fs.existsSync(this.base_dir)) {
        return { success: true, profiles: [] };
      }
      const files = fs.readdirSync(this.base_dir).filter(f => f.endsWith('.json'));
      const profiles = files.map(file => {
        const full = path.join(this.base_dir, file);
        const stat = fs.statSync(full);
        return {
          name: path.basename(file, '.json'),
          path: full,
          modified: stat.mtimeMs
        };
      });
      this._log('list_profiles:', profiles);
      return { success: true, profiles };
    } catch (e) {
      this._log('list_profiles error:', e);
      return { success: false, error: String(e) };
    }
  }

  delete(name) {
    try {
      const p = path.join(this.base_dir, `${name}.json`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      this._log('delete_profile', name);
      return { success: true };
    } catch (e) {
      this._log('delete_profile error:', e);
      return { success: false, error: String(e) };
    }
  }
}

module.exports = { ProfileManager };
