# -*- coding: utf-8 -*-
"""
MIDI Audio Mixer Controller
Веб‑приложение для управления звуком Windows через MIDI микшер
Требования: Python 3.7+, Windows 10/11
"""

import json
import threading
import time
from pathlib import Path

import webview

# MIDI
try:
    import mido
    from mido import Message
    MIDI_AVAILABLE = True
except ImportError:
    print("⚠️  mido не установлена. Установи: pip install mido python-rtmidi")
    MIDI_AVAILABLE = False

# Audio (Windows)
try:
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    from comtypes import CLSCTX_ALL, CoInitialize, CoUninitialize
    from ctypes import cast, POINTER
    AUDIO_AVAILABLE = True
except ImportError:
    print("⚠️  pycaw/comtypes не установлены. Установи: pip install pycaw comtypes")
    AUDIO_AVAILABLE = False


class MidiMixerAPI:
    """
    API, который дергается из JS: window.pywebview.api.*
    """

    def __init__(self):
        self.midi_input = None
        self.midi_output = None
        self.midi_thread = None
        self.midi_running = False

        self.profiles_path = str(Path.home() / '.midi_mixer' / 'profiles')
        Path(self.profiles_path).mkdir(parents=True, exist_ok=True)

        self.learning_mode = False          # активен ли режим
        self.learning_type = None           # 'fader' или 'button'
        self.last_midi_message = None       # последнее подходящее сообщение

        self.debug_log = True

    def _log(self, *args):
        if self.debug_log:
            print('[MIDI MIXER]', *args)

    # --------- Служебное ---------
    def get_profiles_dir(self):
        return self.profiles_path

    # --------- MIDI ---------
    def get_midi_devices(self):
        """Список MIDI‑устройств с реальными именами портов."""
        if not MIDI_AVAILABLE:
            return {'inputs': [], 'outputs': [], 'error': 'MIDI не доступен'}

        try:
            inputs = mido.get_input_names()
            outputs = mido.get_output_names()
            self._log('MIDI devices IN:', inputs, 'OUT:', outputs)
            return {'inputs': inputs, 'outputs': outputs}
        except Exception as e:
            self._log('get_midi_devices ERROR:', e)
            return {'inputs': [], 'outputs': [], 'error': str(e)}

    def connect_midi_input(self, device_name):
        if not MIDI_AVAILABLE:
            return {'success': False, 'error': 'MIDI не доступен'}

        try:
            self._log('connect_midi_input:', device_name)
            self.disconnect_midi()

            self.midi_input = mido.open_input(device_name)
            self.midi_running = True
            self.midi_thread = threading.Thread(
                target=self._midi_listener, daemon=True
            )
            self.midi_thread.start()
            self._log('MIDI thread started')
            return {'success': True, 'device': device_name}
        except Exception as e:
            self._log('connect_midi_input ERROR:', e)
            return {'success': False, 'error': str(e)}

    def connect_midi_output(self, device_name):
        if not MIDI_AVAILABLE:
            return {'success': False, 'error': 'MIDI не доступен'}

        try:
            if self.midi_output:
                self.midi_output.close()
            self.midi_output = mido.open_output(device_name)
            self._log('connect_midi_output:', device_name)
            return {'success': True, 'device': device_name}
        except Exception as e:
            self._log('connect_midi_output ERROR:', e)
            return {'success': False, 'error': str(e)}

    def disconnect_midi(self):
        self.midi_running = False

        if self.midi_thread:
            try:
                self.midi_thread.join(timeout=1)
            except Exception:
                pass
            self.midi_thread = None

        if self.midi_input:
            try:
                self.midi_input.close()
            except Exception:
                pass
            self.midi_input = None

        if self.midi_output:
            try:
                self.midi_output.close()
            except Exception:
                pass
            self.midi_output = None

        return {'success': True}

    def start_midi_learn(self, element_type):
        """
        element_type: 'fader' или 'button'
        """
        self.learning_mode = True
        self.learning_type = element_type
        self.last_midi_message = None
        self._log('start_midi_learn:', element_type)
        return {'success': True, 'learning': True}

    def stop_midi_learn(self):
        self._log('stop_midi_learn, last_midi_message =', self.last_midi_message)
        self.learning_mode = False
        result = self.last_midi_message
        self.last_midi_message = None
        return {'success': True, 'learning': False, 'learned': result}

    def get_last_midi_message(self):
        return {'success': True, 'message': self.last_midi_message}

    def _midi_listener(self):
        self._log('MIDI listener started, learning_mode =', self.learning_mode)
        try:
            for msg in self.midi_input:
                if not self.midi_running:
                    break
                self._log('MIDI IN raw:', msg)
                self._handle_midi_message(msg)
        except Exception as e:
            self._log('MIDI listener ERROR:', e)

    def _handle_midi_message(self, msg):
        """Обработать входящее MIDI сообщение"""
        try:
            data = {
                'type': msg.type,
                'note': getattr(msg, 'note', None),
                'velocity': getattr(msg, 'velocity', None),
                'control': getattr(msg, 'control', None),
                'value': getattr(msg, 'value', None),
                'channel': getattr(msg, 'channel', 0),
                'timestamp': time.time(),
            }
            if msg.type == 'pitchwheel':
                data['pitch'] = getattr(msg, 'pitch', None)

            self._log('MIDI parsed:', data)

            # отправка в JS (advanced view)
            try:
                if webview.windows:
                    js = f"window.__onMidiFromPython({json.dumps(data)})"
                    webview.windows[0].evaluate_js(js)
            except Exception as e:
                self._log('send to JS failed:', e)

            # Режим обучения
            if self.learning_mode:
                self._log('learning_mode =', self.learning_type)

                if self.learning_type == 'fader':
                    # принимаем и CC, и pitchwheel
                    if msg.type in ('control_change', 'pitchwheel'):
                        self.last_midi_message = data
                        self._log('learned FADER message =', data)
                elif self.learning_type == 'button' and msg.type == 'note_on':
                    self.last_midi_message = data
                    self._log('learned BUTTON NOTE =', data['note'])

        except Exception as e:
            self._log('_handle_midi_message ERROR:', e)

    def send_midi_note(self, note, velocity=127, channel=0):
        if not MIDI_AVAILABLE or not self.midi_output:
            return {'success': False, 'error': 'MIDI output не подключен'}
        try:
            msg = Message('note_on', note=note, velocity=velocity, channel=channel)
            self.midi_output.send(msg)
            self._log('send_midi_note', note, velocity, channel)
            return {'success': True}
        except Exception as e:
            self._log('send_midi_note ERROR:', e)
            return {'success': False, 'error': str(e)}

    def send_midi_cc(self, control, value, channel=0):
        if not MIDI_AVAILABLE or not self.midi_output:
            return {'success': False, 'error': 'MIDI output не подключен'}
        try:
            msg = Message('control_change', control=control, value=value, channel=channel)
            self.midi_output.send(msg)
            self._log('send_midi_cc', control, value, channel)
            return {'success': True}
        except Exception as e:
            self._log('send_midi_cc ERROR:', e)
            return {'success': False, 'error': str(e)}

    # --------- Audio / Windows ---------
    def get_audio_applications(self):
        if not AUDIO_AVAILABLE:
            return {'applications': [], 'error': 'Аудио не доступно'}

        try:
            CoInitialize()
            apps = []
            sessions = AudioUtilities.GetAllSessions()

            for session in sessions:
                if session.Process:
                    pname = session.Process.name()
                    if pname and pname not in [a['process'] for a in apps]:
                        try:
                            vol = session.SimpleAudioVolume
                            apps.append({
                                'name': pname.replace('.exe', '').title(),
                                'process': pname,
                                'volume': int(vol.GetMasterVolume() * 100),
                                'muted': bool(vol.GetMute()),
                            })
                        except Exception:
                            pass

            try:
                device = AudioUtilities.GetSpeakers()
                interface = device.Activate(
                    IAudioEndpointVolume._iid_, CLSCTX_ALL, None
                )
                vol = cast(interface, POINTER(IAudioEndpointVolume))
                apps.insert(0, {
                    'name': 'Системная громкость',
                    'process': 'master',
                    'volume': int(vol.GetMasterVolumeLevelScalar() * 100),
                    'muted': bool(vol.GetMute()),
                })
            except Exception:
                pass

            CoUninitialize()
            self._log('get_audio_applications:', apps)
            return {'applications': apps}
        except Exception as e:
            self._log('get_audio_applications ERROR:', e)
            return {'applications': [], 'error': str(e)}

    def set_app_volume(self, process_name, volume):
        if not AUDIO_AVAILABLE:
            return {'success': False, 'error': 'Аудио не доступно'}
        try:
            CoInitialize()
            scalar = max(0.0, min(1.0, volume / 100.0))

            if process_name == 'master':
                device = AudioUtilities.GetSpeakers()
                interface = device.Activate(
                    IAudioEndpointVolume._iid_, CLSCTX_ALL, None
                )
                vol = cast(interface, POINTER(IAudioEndpointVolume))
                vol.SetMasterVolumeLevelScalar(scalar, None)
            else:
                sessions = AudioUtilities.GetAllSessions()
                for session in sessions:
                    if session.Process and session.Process.name() == process_name:
                        vol = session.SimpleAudioVolume
                        vol.SetMasterVolume(scalar, None)
                        break

            CoUninitialize()
            self._log('set_app_volume', process_name, volume)
            return {'success': True, 'volume': volume}
        except Exception as e:
            self._log('set_app_volume ERROR:', e)
            return {'success': False, 'error': str(e)}

    def toggle_app_mute(self, process_name):
        if not AUDIO_AVAILABLE:
            return {'success': False, 'error': 'Аудио не доступно'}
        try:
            CoInitialize()
            new_state = False

            if process_name == 'master':
                device = AudioUtilities.GetSpeakers()
                interface = device.Activate(
                    IAudioEndpointVolume._iid_, CLSCTX_ALL, None
                )
                vol = cast(interface, POINTER(IAudioEndpointVolume))
                cur = vol.GetMute()
                vol.SetMute(not cur, None)
                new_state = not cur
            else:
                sessions = AudioUtilities.GetAllSessions()
                for session in sessions:
                    if session.Process and session.Process.name() == process_name:
                        vol = session.SimpleAudioVolume
                        cur = vol.GetMute()
                        vol.SetMute(not cur, None)
                        new_state = not cur
                        break

            CoUninitialize()
            self._log('toggle_app_mute', process_name, new_state)
            return {'success': True, 'muted': new_state}
        except Exception as e:
            self._log('toggle_app_mute ERROR:', e)
            return {'success': False, 'error': str(e)}

    # --------- Профили ---------
    def save_profile(self, name, data):
        try:
            path = Path(self.profiles_path) / f'{name}.json'
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self._log('save_profile', name, '->', path)
            return {'success': True, 'path': str(path)}
        except Exception as e:
            self._log('save_profile ERROR:', e)
            return {'success': False, 'error': str(e)}

    def load_profile(self, name):
        try:
            path = Path(self.profiles_path) / f'{name}.json'
            if not path.exists():
                return {'success': False, 'error': 'Профиль не найден'}
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self._log('load_profile', name)
            return {'success': True, 'data': data}
        except Exception as e:
            self._log('load_profile ERROR:', e)
            return {'success': False, 'error': str(e)}

    def list_profiles(self):
        try:
            profiles = []
            pdir = Path(self.profiles_path)
            for file in pdir.glob('*.json'):
                profiles.append({
                    'name': file.stem,
                    'path': str(file),
                    'modified': file.stat().st_mtime,
                })
            self._log('list_profiles:', profiles)
            return {'success': True, 'profiles': profiles}
        except Exception as e:
            self._log('list_profiles ERROR:', e)
            return {'success': False, 'error': str(e)}

    def delete_profile(self, name):
        try:
            path = Path(self.profiles_path) / f'{name}.json'
            if path.exists():
                path.unlink()
            self._log('delete_profile', name)
            return {'success': True}
        except Exception as e:
            self._log('delete_profile ERROR:', e)
            return {'success': False, 'error': str(e)}


def get_html_path():
    html_file = Path(__file__).parent / 'index.html'
    if not html_file.exists():
        print("⚠️ index.html не найден:", html_file)
        return None
    return str(html_file)


def main():
    print("🎚️  MIDI Audio Mixer - запуск...")

    if not MIDI_AVAILABLE:
        print("⚠️ MIDI не доступен (нет mido/python-rtmidi)")
    if not AUDIO_AVAILABLE:
        print("⚠️ Audio не доступно (нет pycaw/comtypes)")

    api = MidiMixerAPI()
    html_path = get_html_path()

    if html_path:
        webview.create_window(
            'MIDI Audio Mixer',
            html_path,
            js_api=api,
            width=1200,
            height=800,
            resizable=True,
            min_size=(800, 600),
        )
    else:
        webview.create_window(
            'MIDI Audio Mixer - ошибка',
            html="<h1>index.html не найден</h1>",
            js_api=api,
            width=600,
            height=200,
        )

    webview.start(debug=True)
    api.disconnect_midi()
    print("👋 приложение закрыто")


if __name__ == '__main__':
    main()
