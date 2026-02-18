# test_mixer_logger.py
# Простой тест работы MIDI-микшера: логирование всех входящих сообщений

import time

try:
    import mido
    from mido import Message
except ImportError:
    print('mido не установлена. Установи: pip install mido python-rtmidi')
    raise

def choose_input_port():
    inputs = mido.get_input_names()
    if not inputs:
        print('Нет доступных MIDI входов.')
        return None

    print('Доступные MIDI входы:')
    for i, name in enumerate(inputs):
        print(f'  [{i}] {name}')

    while True:
        try:
            idx = int(input('Выбери номер входа: '))
            if 0 <= idx < len(inputs):
                return inputs[idx]
        except ValueError:
            pass
        print('Неверный ввод, попробуй ещё раз.')

def main():
    port_name = choose_input_port()
    if not port_name:
        return

    print(f'\nОткрываю MIDI вход: {port_name}')
    print('Двигай фейдеры, крути кнобы, нажимай кнопки.')
    print('Нажми Ctrl+C для выхода.\n')

    with mido.open_input(port_name) as inport:
        try:
            for msg in inport:
                now = time.strftime('%H:%M:%S')
                # msg.type: control_change, note_on, note_off, pitchwheel и т.п.
                # Для CC: msg.control, msg.value
                # Для нот: msg.note, msg.velocity
                print(f'[{now}] {msg}')
        except KeyboardInterrupt:
            print('\nВыход.')

if __name__ == '__main__':
    main()
