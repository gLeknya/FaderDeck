# midi_mixer.py
import sys
from pathlib import Path

import webview

from backend.api import MidiMixerAPI


def get_html_path():
    base = Path(__file__).parent
    html_file = base / 'web' / 'index.html'
    if not html_file.exists():
        print("⚠️ index.html not found:", html_file)
        return None
    return str(html_file)


def main():
    print("🎚️  FaderDeck - starting...")

    api = MidiMixerAPI()
    html_path = get_html_path()

    if html_path:
        webview.create_window(
            'FaderDeck',
            html_path,
            js_api=api,
            width=1200,
            height=800,
            resizable=True,
            min_size=(800, 600),
        )
    else:
        webview.create_window(
            'FaderDeck - error',
            html="<h1>index.html not found</h1>",
            js_api=api,
            width=600,
            height=200,
        )

    webview.start(debug=True)
    api.shutdown()
    print("👋 FaderDeck closed")


if __name__ == '__main__':
    sys.exit(main())
