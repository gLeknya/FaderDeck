# backend/midi.py
import threading
import time

try:
    import mido
    from mido import Message
    MIDI_AVAILABLE = True
except ImportError:
    MIDI_AVAILABLE = False


class MidiManager:
    def __init__(self, log_func=None, js_callback=None):
        """
        js_callback(data_dict) будет вызван для каждого MIDI сообщения.
        """
        self._log = log_func or (lambda *a, **k: None)
        self._js_callback = js_callback

        self.midi_input = None
        self.midi_output = None
        self.midi_thread = None
        self.midi_running = False

        # learn state
        self.learning_mode = False
        self.learning_type = None   # 'fader' or 'button'
        self.last_midi_message = None

    # --------- Devices ---------

    def get_devices(self):
        if not MIDI_AVAILABLE:
            return {'inputs': [], 'outputs': [], 'error': 'MIDI not available'}
        try:
            inputs = mido.get_input_names()
            outputs = mido.get_output_names()
            self._log('MIDI devices IN:', inputs, 'OUT:', outputs)
            return {'inputs': inputs, 'outputs': outputs}
        except Exception as e:
            self._log('get_devices error:', e)
            return {'inputs': [], 'outputs': [], 'error': str(e)}

    def connect_input(self, name):
        if not MIDI_AVAILABLE:
            return {'success': False, 'error': 'MIDI not available'}

        try:
            self.disconnect()
            self._log('connect_input:', name)
            self.midi_input = mido.open_input(name)
            self.midi_running = True
            self.midi_thread = threading.Thread(target=self._listener, daemon=True)
            self.midi_thread.start()
            return {'success': True, 'device': name}
        except Exception as e:
            self._log('connect_input error:', e)
            return {'success': False, 'error': str(e)}

    def connect_output(self, name):
        if not MIDI_AVAILABLE:
            return {'success': False, 'error': 'MIDI not available'}
        try:
            if self.midi_output:
                self.midi_output.close()
            self.midi_output = mido.open_output(name)
            self._log('connect_output:', name)
            return {'success': True, 'device': name}
        except Exception as e:
            self._log('connect_output error:', e)
            return {'success': False, 'error': str(e)}

    def disconnect(self):
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

    # --------- Learn mode ---------

    def start_learn(self, element_type: str):
        self.learning_mode = True
        self.learning_type = element_type
        self.last_midi_message = None
        self._log('start_learn:', element_type)
        return {'success': True, 'learning': True}

    def stop_learn(self):
        self._log('stop_learn, last=', self.last_midi_message)
        self.learning_mode = False
        result = self.last_midi_message
        self.last_midi_message = None
        return {'success': True, 'learning': False, 'learned': result}

    def get_last_message(self):
        return {'success': True, 'message': self.last_midi_message}

    # --------- Send ---------

    def send_note(self, note, velocity=127, channel=0):
        if not MIDI_AVAILABLE or not self.midi_output:
            return {'success': False, 'error': 'MIDI output not connected'}
        try:
            msg = Message('note_on', note=note, velocity=velocity, channel=channel)
            self.midi_output.send(msg)
            self._log('send_note', note, velocity, channel)
            return {'success': True}
        except Exception as e:
            self._log('send_note error:', e)
            return {'success': False, 'error': str(e)}

    def send_cc(self, control, value, channel=0):
        if not MIDI_AVAILABLE or not self.midi_output:
            return {'success': False, 'error': 'MIDI output not connected'}
        try:
            msg = Message('control_change', control=control, value=value, channel=channel)
            self.midi_output.send(msg)
            self._log('send_cc', control, value, channel)
            return {'success': True}
        except Exception as e:
            self._log('send_cc error:', e)
            return {'success': False, 'error': str(e)}

    # --------- Internal listener ---------

    def _listener(self):
        self._log('MIDI listener started, learning_mode =', self.learning_mode)
        try:
            for msg in self.midi_input:
                if not self.midi_running:
                    break
                self._handle_msg(msg)
        except Exception as e:
            self._log('MIDI listener error:', e)

    def _handle_msg(self, msg):
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

            if self._js_callback:
                self._js_callback(data)

            if self.learning_mode:
                if self.learning_type == 'fader':
                    if msg.type in ('control_change', 'pitchwheel'):
                        self.last_midi_message = data
                        self._log('learned FADER', data)
                elif self.learning_type == 'button' and msg.type == 'note_on':
                    self.last_midi_message = data
                    self._log('learned BUTTON', data)
        except Exception as e:
            self._log('_handle_msg error:', e)
