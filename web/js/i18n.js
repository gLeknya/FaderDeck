const TRANSLATIONS = Object.freeze({
  ru: {
    toolbar: {
      menu: 'Меню',
      selectMidi: 'Выберите MIDI-устройство'
    },
    status: {
      notConnected: 'не подключено',
      unsupported: 'не поддерживается',
      connectionFailed: 'ошибка подключения',
      devices: '{count} устройств'
    },
    menu: {
      title: 'Меню',
      tabs: {
        site: 'Главная',
        plugins: 'Плагины',
        settings: 'Настройки'
      },
      sitePlaceholder: 'Раздел пока не реализован.',
      pluginsPlaceholder: 'Раздел плагинов пока не реализован.'
    },
    settings: {
      developerMode: 'Режим разработчика',
      advancedMode: 'Расширенный режим',
      startOnBoot: 'Запуск с системой',
      language: 'Язык',
      incomingMidi: 'Входящие MIDI-сообщения',
      on: 'Вкл',
      off: 'Выкл'
    },
    languages: {
      ru: 'Русский',
      en: 'English'
    },
    empty: {
      message: 'Нажмите "+" справа, чтобы добавить канал,<br>или создайте отдельную кнопку ниже'
    },
    buttonModal: {
      title: 'Настройки кнопки',
      text: 'Текст',
      textPlaceholder: 'Mute',
      icon: 'Иконка',
      iconPlaceholder: 'M',
      midiNote: 'MIDI Note',
      key: 'Клавиша',
      keyPlaceholder: 'Нажмите клавишу...'
    },
    buttons: {
      defaultLabel: 'Кнопка',
      buttonLearnMissing: 'MIDI learn для кнопки пока не реализован.',
      standaloneLearnMissing: 'MIDI learn для отдельной кнопки пока не реализован.'
    },
    channels: {
      defaultTitle: 'Канал {index}',
      unnamed: 'Без названия',
      bindToMixer: 'Привязать к микшеру',
      unboundWarning: 'Этот фейдер не привязан к MIDI-контроллеру. Он будет работать только через UI.',
      channelNamePrompt: 'Название канала:',
      advancedControlChange: 'control_change (CC {control})',
      advancedPitchwheel: 'pitchwheel (ch {channel})'
    },
    midi: {
      initialized: 'WebMIDI инициализирован',
      unsupported: 'Web MIDI API не поддерживается',
      initFailed: 'Ошибка инициализации WebMIDI',
      moveFader: 'Переместите фейдер для канала "{name}"',
      failedToDetect: 'Не удалось определить движение фейдера',
      bindCancelled: 'Привязка фейдера отменена',
      bindSuccess: 'Фейдер привязан',
      conflict: 'Этот контроллер уже используется каналом "{name}". Всё равно привязать?'
    },
    context: {
      edit: 'Изменить',
      remap: 'Переназначить',
      delete: 'Удалить'
    },
    common: {
      cancel: 'Отмена',
      save: 'Сохранить'
    },
    profile: {
      autoSaveOnly: 'UI профилей пока не реализован, используется автосохранение.'
    },
    audio: {
      systemVolume: 'Системная громкость'
    }
  },
  en: {
    toolbar: {
      menu: 'Menu',
      selectMidi: 'Select MIDI device'
    },
    status: {
      notConnected: 'not connected',
      unsupported: 'unsupported',
      connectionFailed: 'connection failed',
      devices: '{count} device(s)'
    },
    menu: {
      title: 'Menu',
      tabs: {
        site: 'Home',
        plugins: 'Plugins',
        settings: 'Settings'
      },
      sitePlaceholder: 'This section is not implemented yet.',
      pluginsPlaceholder: 'Plugins section is not implemented yet.'
    },
    settings: {
      developerMode: 'Developer mode',
      advancedMode: 'Advanced mode',
      startOnBoot: 'Start on boot',
      language: 'Language',
      incomingMidi: 'Incoming MIDI messages',
      on: 'On',
      off: 'Off'
    },
    languages: {
      ru: 'Russian',
      en: 'English'
    },
    empty: {
      message: 'Click "+" on the right to add a channel,<br>or create a standalone button below'
    },
    buttonModal: {
      title: 'Button settings',
      text: 'Text',
      textPlaceholder: 'Mute',
      icon: 'Icon',
      iconPlaceholder: 'M',
      midiNote: 'MIDI Note',
      key: 'Key',
      keyPlaceholder: 'Press a key...'
    },
    buttons: {
      defaultLabel: 'Button',
      buttonLearnMissing: 'Button MIDI learn is not implemented yet.',
      standaloneLearnMissing: 'Standalone button MIDI learn is not implemented yet.'
    },
    channels: {
      defaultTitle: 'Channel {index}',
      unnamed: 'Unassigned',
      bindToMixer: 'Bind to mixer',
      unboundWarning: 'This fader is not bound to a MIDI control. It will only respond to the UI.',
      channelNamePrompt: 'Channel name:',
      advancedControlChange: 'control_change (CC {control})',
      advancedPitchwheel: 'pitchwheel (ch {channel})'
    },
    midi: {
      initialized: 'WebMIDI initialized',
      unsupported: 'Web MIDI API not supported',
      initFailed: 'WebMIDI initialization failed',
      moveFader: 'Move the fader for channel "{name}"',
      failedToDetect: 'Failed to detect fader movement',
      bindCancelled: 'Fader binding cancelled',
      bindSuccess: 'Fader bound',
      conflict: 'This controller is already used by channel "{name}". Bind anyway?'
    },
    context: {
      edit: 'Edit',
      remap: 'Reassign',
      delete: 'Delete'
    },
    common: {
      cancel: 'Cancel',
      save: 'Save'
    },
    profile: {
      autoSaveOnly: 'Profile UI is not implemented yet, use auto-save.'
    },
    audio: {
      systemVolume: 'System volume'
    }
  }
});

const DEFAULT_LANGUAGE = 'ru';
const LANGUAGE_STORAGE_KEY = 'faderdeck_language';
let currentLanguage = DEFAULT_LANGUAGE;

function getNestedValue(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function interpolate(text, params = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`);
}

function getSupportedLanguage(language) {
  return TRANSLATIONS[language] ? language : DEFAULT_LANGUAGE;
}

function getInitialLanguage() {
  const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  const browserLanguage = navigator.language?.slice(0, 2);
  return getSupportedLanguage(savedLanguage || browserLanguage || DEFAULT_LANGUAGE);
}

function getCurrentLanguage() {
  return currentLanguage;
}

function t(key, params = {}) {
  const dictionary = TRANSLATIONS[currentLanguage] || TRANSLATIONS[DEFAULT_LANGUAGE];
  const fallbackDictionary = TRANSLATIONS[DEFAULT_LANGUAGE];
  const value = getNestedValue(dictionary, key) ?? getNestedValue(fallbackDictionary, key) ?? key;
  return interpolate(value, params);
}

function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.innerHTML = t(element.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });

  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
}

function setLanguage(language, options = {}) {
  const nextLanguage = getSupportedLanguage(language);
  const shouldPersist = options.persist !== false;
  const force = options.force === true;

  if (!force && nextLanguage === currentLanguage) {
    return;
  }

  currentLanguage = nextLanguage;
  document.documentElement.lang = nextLanguage;

  if (shouldPersist) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  }

  applyTranslations();
  window.dispatchEvent(new CustomEvent('app:language-changed', {
    detail: { language: nextLanguage }
  }));
}

currentLanguage = getInitialLanguage();
document.documentElement.lang = currentLanguage;
