# backend/profiles.py
import json
from pathlib import Path


class ProfileManager:
    def __init__(self, base_dir: Path, log_func=None):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._log = log_func or (lambda *a, **k: None)

    def save(self, name: str, data: dict):
        try:
            path = self.base_dir / f'{name}.json'
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self._log('save_profile', name, '->', path)
            return {'success': True, 'path': str(path)}
        except Exception as e:
            self._log('save_profile error:', e)
            return {'success': False, 'error': str(e)}

    def load(self, name: str):
        try:
            path = self.base_dir / f'{name}.json'
            if not path.exists():
                return {'success': False, 'error': 'Profile not found'}
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self._log('load_profile', name)
            return {'success': True, 'data': data}
        except Exception as e:
            self._log('load_profile error:', e)
            return {'success': False, 'error': str(e)}

    def list_profiles(self):
        try:
            profiles = []
            for file in self.base_dir.glob('*.json'):
                profiles.append({
                    'name': file.stem,
                    'path': str(file),
                    'modified': file.stat().st_mtime,
                })
            self._log('list_profiles:', profiles)
            return {'success': True, 'profiles': profiles}
        except Exception as e:
            self._log('list_profiles error:', e)
            return {'success': False, 'error': str(e)}

    def delete(self, name: str):
        try:
            path = self.base_dir / f'{name}.json'
            if path.exists():
                path.unlink()
            self._log('delete_profile', name)
            return {'success': True}
        except Exception as e:
            self._log('delete_profile error:', e)
            return {'success': False, 'error': str(e)}
