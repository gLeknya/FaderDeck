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
      devices: '{count} устр.'
    },
    menu: {
      tabs: {
        profiles: 'Профили',
        plugins: 'Плагины',
        settings: 'Настройки',
        account: 'Аккаунт'
      },
      pluginsPlaceholder: 'Раздел плагинов пока не реализован.',
      accountPlaceholder: 'Раздел аккаунта пока не реализован.'
    },
    settings: {
      developerMode: 'Режим разработчика',
      advancedMode: 'Расширенный режим',
      startOnBoot: 'Запуск с системой',
      language: 'Язык',
      incomingMidi: 'Входящие MIDI-сообщения',
      openDevtools: 'Открыть DevTools',
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
      textPlaceholder: 'Button',
      icon: 'Иконка',
      iconPlaceholder: 'BTN',
      midiNote: 'MIDI Note',
      key: 'Клавиша',
      keyPlaceholder: 'Нажмите клавишу...'
    },
    buttons: {
      defaultLabel: 'Button',
      buttonLearnMissing: 'MIDI learn для кнопки пока не реализован.',
      standaloneLearnMissing: 'MIDI learn для отдельной кнопки пока не реализован.',
      standaloneLimit: 'Можно добавить максимум 24 отдельные кнопки.',
      channelLimit: 'В одном канале доступно только 4 кнопки.'
    },
    channels: {
      defaultTitle: 'Канал {index}',
      unnamed: 'Без названия',
      bindToMixer: 'Привязать к микшеру',
      unboundWarning: 'Этот фейдер не привязан к MIDI-контроллеру. Он будет работать только через интерфейс.',
      channelNamePrompt: 'Название канала:',
      advancedControlChange: 'control_change (CC {control})',
      advancedPitchwheel: 'pitchwheel (ch {channel})',
      addButton: 'Добавить'
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
      autoSaveOnly: 'Интерфейс профилей заменён новым разделом в меню.'
    },
    profiles: {
      toolbarTitle: 'Быстрый выбор профиля',
      toolbarPlaceholder: 'Профили',
      saveCurrent: 'Сохранить свой профиль',
      newProfile: 'Мой профиль',
      emptyTitle: 'Пока нет профилей',
      emptyText: 'Сохраните текущую раскладку или импортируйте профиль из файла.',
      showInToolbarTitle: 'Показывать в toolbar',
      itemActions: 'Действия с профилем',
      revealInFolder: 'Показать в папке',
      uploadToSite: 'Загрузить на сайт',
      delete: 'Удалить профиль',
      openFolder: 'Открыть папку профилей',
      importMenu: 'Добавить профиль',
      importFromFile: 'Файлом',
      importFromSite: 'С сайта',
      loaded: 'Профиль "{name}" загружен.',
      loadFailed: 'Не удалось загрузить профиль "{name}".',
      saved: 'Профиль "{name}" сохранён.',
      saveFailed: 'Не удалось сохранить профиль.',
      renamed: 'Профиль переименован в "{name}".',
      renameFailed: 'Не удалось переименовать профиль.',
      deleted: 'Профиль "{name}" удалён.',
      deleteFailed: 'Не удалось удалить профиль.',
      deleteConfirm: 'Удалить профиль "{name}"?',
      imported: 'Профиль "{name}" импортирован.',
      importFailed: 'Не удалось импортировать профиль из файла.',
      failedToLoad: 'Не удалось получить список профилей.',
      emptyName: 'Название профиля не может быть пустым.',
      nameExists: 'Профиль с таким названием уже существует.',
      uploadSoon: 'Загрузка профиля на сайт пока не реализована.',
      importFromSiteSoon: 'Импорт профиля с сайта пока не реализован.'
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
      tabs: {
        profiles: 'Profiles',
        plugins: 'Plugins',
        settings: 'Settings',
        account: 'Account'
      },
      pluginsPlaceholder: 'Plugins section is not implemented yet.',
      accountPlaceholder: 'Account section is not implemented yet.'
    },
    settings: {
      developerMode: 'Developer mode',
      advancedMode: 'Advanced mode',
      startOnBoot: 'Start on boot',
      language: 'Language',
      incomingMidi: 'Incoming MIDI messages',
      openDevtools: 'Open DevTools',
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
      textPlaceholder: 'Button',
      icon: 'Icon',
      iconPlaceholder: 'BTN',
      midiNote: 'MIDI Note',
      key: 'Key',
      keyPlaceholder: 'Press a key...'
    },
    buttons: {
      defaultLabel: 'Button',
      buttonLearnMissing: 'Button MIDI learn is not implemented yet.',
      standaloneLearnMissing: 'Standalone button MIDI learn is not implemented yet.',
      standaloneLimit: 'You can add up to 24 standalone buttons.',
      channelLimit: 'Only 4 buttons are available per channel.'
    },
    channels: {
      defaultTitle: 'Channel {index}',
      unnamed: 'Untitled',
      bindToMixer: 'Bind to mixer',
      unboundWarning: 'This fader is not bound to a MIDI control. It will only respond through the interface.',
      channelNamePrompt: 'Channel name:',
      advancedControlChange: 'control_change (CC {control})',
      advancedPitchwheel: 'pitchwheel (ch {channel})',
      addButton: 'Add'
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
      autoSaveOnly: 'The old profile modal was replaced by the profiles panel.'
    },
    profiles: {
      toolbarTitle: 'Quick profile selector',
      toolbarPlaceholder: 'Profiles',
      saveCurrent: 'Save current profile',
      newProfile: 'My profile',
      emptyTitle: 'No profiles yet',
      emptyText: 'Save the current layout or import a profile from a file.',
      showInToolbarTitle: 'Show in toolbar',
      itemActions: 'Profile actions',
      revealInFolder: 'Reveal in folder',
      uploadToSite: 'Upload to site',
      delete: 'Delete profile',
      openFolder: 'Open profiles folder',
      importMenu: 'Add profile',
      importFromFile: 'From file',
      importFromSite: 'From site',
      loaded: 'Profile "{name}" loaded.',
      loadFailed: 'Failed to load profile "{name}".',
      saved: 'Profile "{name}" saved.',
      saveFailed: 'Failed to save profile.',
      renamed: 'Profile renamed to "{name}".',
      renameFailed: 'Failed to rename profile.',
      deleted: 'Profile "{name}" deleted.',
      deleteFailed: 'Failed to delete profile.',
      deleteConfirm: 'Delete profile "{name}"?',
      imported: 'Profile "{name}" imported.',
      importFailed: 'Failed to import profile from file.',
      failedToLoad: 'Failed to load profile list.',
      emptyName: 'Profile name cannot be empty.',
      nameExists: 'A profile with this name already exists.',
      uploadSoon: 'Uploading profiles to the site is not implemented yet.',
      importFromSiteSoon: 'Importing profiles from the site is not implemented yet.'
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
