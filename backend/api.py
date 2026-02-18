# backend/api.py
from pathlib import Path

from .midi import MidiManager
from .audio import AudioManager
from .profiles import ProfileManager

import webview


class MidiMixerAPI:
    def __init__(self):
        self.debug_log = True

        self.profiles_path = Path.home() / '.midi_mixer' / 'profiles'
        self.profile_mgr = ProfileManager(self.profiles_path, self._log)
        self.audio_mgr = AudioManager(self._log)
        self.midi_mgr = MidiManager(
            log_func=self._log,
            js_callback=self._send_midi_to_js
        )

    def _log(self, *args):
        if self.debug_log:
            print('[FaderDeck]', *args)

    # -------- pywebview JS hooks --------

    # MIDI devices
    def get_midi_devices(self):
        return self.midi_mgr.get_devices()

    def connect_midi_input(self, device_name):
        return self.midi_mgr.connect_input(device_name)

    def connect_midi_output(self, device_name):
        return self.midi_mgr.connect_output(device_name)

    def disconnect_midi(self):
        return self.midi_mgr.disconnect()

    # MIDI learn
    def start_midi_learn(self, element_type):
        return self.midi_mgr.start_learn(element_type)

    def stop_midi_learn(self):
        return self.midi_mgr.stop_learn()

    def get_last_midi_message(self):
        return self.midi_mgr.get_last_message()

    # MIDI send
    def send_midi_note(self, note, velocity=127, channel=0):
        return self.midi_mgr.send_note(note, velocity, channel)

    def send_midi_cc(self, control, value, channel=0):
        return self.midi_mgr.send_cc(control, value, channel)

    # Audio
    def get_audio_applications(self):
        return self.audio_mgr.list_applications()

    def set_app_volume(self, process_name, volume):
        return self.audio_mgr.set_volume(process_name, volume)

    def toggle_app_mute(self, process_name):
        return self.audio_mgr.toggle_mute(process_name)

    # Profiles
    def save_profile(self, name, data):
        return self.profile_mgr.save(name, data)

    def load_profile(self, name):
        return self.profile_mgr.load(name)

    def list_profiles(self):
        return self.profile_mgr.list_profiles()

    def delete_profile(self, name):
        return self.profile_mgr.delete(name)

    # Shutdown
    def shutdown(self):
        self.midi_mgr.disconnect()

    # Internal: send MIDI to JS advanced pane
    def _send_midi_to_js(self, msg_dict):
        try:
            if webview.windows:
                js = f"window.__onMidiFromPython({msg_dict})"
                webview.windows[0].evaluate_js(js)
        except Exception as e:
            self._log('send to JS failed:', e)
