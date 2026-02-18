# backend/audio.py
from pathlib import Path

try:
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    from comtypes import CLSCTX_ALL, CoInitialize, CoUninitialize
    from ctypes import cast, POINTER
    AUDIO_AVAILABLE = True
except ImportError:
    AUDIO_AVAILABLE = False


class AudioManager:
    def __init__(self, log_func=None):
        self._log = log_func or (lambda *a, **k: None)

    def list_applications(self):
        if not AUDIO_AVAILABLE:
            return {'applications': [], 'error': 'Audio not available'}

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
                    'name': 'System volume',
                    'process': 'master',
                    'volume': int(vol.GetMasterVolumeLevelScalar() * 100),
                    'muted': bool(vol.GetMute()),
                })
            except Exception:
                pass

            CoUninitialize()
            #self._log('list_applications:', apps)
            return {'applications': apps}
        except Exception as e:
            #self._log('list_applications error:', e)
            return {'applications': [], 'error': str(e)}

    def set_volume(self, process_name, volume):
        if not AUDIO_AVAILABLE:
            return {'success': False, 'error': 'Audio not available'}
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
            self._log('set_volume', process_name, volume)
            return {'success': True, 'volume': volume}
        except Exception as e:
            self._log('set_volume error:', e)
            return {'success': False, 'error': str(e)}

    def toggle_mute(self, process_name):
        if not AUDIO_AVAILABLE:
            return {'success': False, 'error': 'Audio not available'}
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
                        new_state =  not cur
                        break

            CoUninitialize()
            self._log('toggle_mute', process_name, new_state)
            return {'success': True, 'muted': new_state}
        except Exception as e:
            self._log('toggle_mute error:', e)
            return {'success': False, 'error': str(e)}
