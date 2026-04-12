const TRANSLATIONS = Object.freeze({
  ru: {
    toolbar: {
      menu: 'Меню',
      selectMidi: 'Найти устройства',
      scanningMidi: 'Поиск MIDI-устройств...',
      disableMidi: 'Выключить'
    },
    status: {
      notConnected: 'не подключено',
      unsupported: 'не поддерживается',
      connectionFailed: 'ошибка подключения',
      disabled: 'выключено',
      devices: '{count} устр.'
    },
    menu: {
      tabs: {
        profiles: 'Профили',
        plugins: 'Плагины',
        settings: 'Настройки',
        account: 'Аккаунт'
      },
      comingSoonTitle: 'Скоро будет',
      pluginsPlaceholder: 'Раздел плагинов пока не реализован.',
      accountPlaceholder: 'Раздел аккаунта пока не реализован.'
    },
    settings: {
      sections: {
        faders: 'Фейдеры',
        visual: 'Визуал',
        volumeHud: 'Volume HUD',
        system: 'Система',
        advanced: 'Дополнительно'
      },
      developerMode: 'Режим разработчика',
      advancedMode: 'Расширенный режим',
      profileToolbarSwitcher: 'Смена профилей на toolbar',
      volumeHudEnabled: 'Volume HUD',
      volumeHudPosition: 'Положение HUD',
      volumeHudOrientation: 'Ориентация HUD',
      volumeHudVisibleElements: 'Видимые элементы',
      volumeHudPreview: 'Предпросмотр',
      volumeHudPreviewTitle: 'FaderDeck',
      volumeHudPreviewSubtitle: 'Канал 1',
      volumeHudShowIcon: 'Иконка приложения',
      volumeHudShowTitle: 'Название цели',
      volumeHudShowSubtitle: 'Подпись канала',
      volumeHudShowPercent: 'Процент громкости',
      volumeHudShowMeter: 'Индикатор громкости',
      volumeHudPositions: {
        bottomCenter: 'Снизу по центру',
        bottomLeft: 'Снизу слева',
        bottomRight: 'Снизу справа',
        topCenter: 'Сверху по центру',
        topLeft: 'Сверху слева',
        topRight: 'Сверху справа'
      },
      volumeHudOrientations: {
        horizontal: 'Горизонтально',
        vertical: 'Вертикально'
      },
      faderInterpolation: 'Интерполяция фейдеров',
      faderInterpolationHelp: 'Между начальной и конечной точкой громкости пытается сгладить громкость, чтобы не было резких скачков. Может появиться небольшая задержка.',
      softTakeover: 'Soft takeover',
      softTakeoverHelp: 'Пока физический фейдер не подойдёт к текущему значению канала, входящие MIDI-движения игнорируются. Это помогает избежать резких скачков громкости при переключении профилей и раскладок.',
      softTakeoverThreshold: 'Порог pickup',
      showFractionalNumbers: 'Показывать дробные числа',
      showFractionalOnlyLow: 'Только при малых числах',
      volumeCurve: 'Кривая громкости',
      volumeCurveHelp: 'Громкость изменяется не линейно, а по кривой, из-за чего можно более детально настраивать громкость.',
      curveEaseIn: 'Ease in',
      curveEaseOut: 'Ease out',
      curveEaseInOut: 'Ease in out',
      startOnBoot: 'Запуск с системой',
      language: 'Язык',
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
    editor: {
      preview: 'Preview',
      close: 'Закрыть',
      faderType: 'Фейдер',
      buttonType: 'Кнопка',
      channelButtons: 'Кнопки канала',
      addChannelButton: 'Добавить кнопку',
      openButton: 'Открыть',
      openButtonPanel: 'Открыть панель кнопки',
      removeChannelButton: 'Удалить кнопку',
      buttonPlacement: 'Расположение',
      buttonPlacementBottom: 'Снизу',
      buttonPlacementSide: 'Сбоку',
      buttonPanelTitle: 'Настройки кнопки',
      buttonPanelSubtitle: '',
      buttonPanelTargetButton: 'Кнопка канала',
      buttonName: 'Название',
      buttonIcon: 'Иконка',
      buttonAction: 'Действие',
      buttonActionNone: 'Без действия',
      buttonIndicator: 'Индикатор',
      buttonModePush: 'push',
      buttonModeToggle: 'toggle',
      buttonModeTrigger: 'trigger',
      buttonModeLink: 'Связать',
      buttonContentDisplay: 'Показывать',
      buttonMetaDisplay: 'Нижний блок',
      buttonContentDisplayIconTitle: 'Иконка и имя',
      buttonContentDisplayIconOnly: 'Только иконка',
      buttonContentDisplayTitleOnly: 'Только название',
      buttonMetaDisplayActionIndicator: 'Действие и индикатор',
      buttonMetaDisplayActionOnly: 'Только действие',
      buttonMetaDisplayIndicatorOnly: 'Только индикатор',
      buttonActionMute: 'Mute',
      buttonActionSolo: 'Solo',
      buttonActionSetVolume: 'Set volume',
      buttonActionSendKey: 'Send key',
      buttonIndicatorToggle: 'Переключаемая',
      buttonIndicatorMeter: 'Пикометр',
      buttonIndicatorPress: 'Гореть при нажатии',
      buttonKey: 'Клавиша',
      buttonKeyPlaceholder: 'Нажмите клавишу...',
      buttonKeyRequired: 'Сначала выберите клавишу для send key',
      buttonSetVolumeValue: 'Громкость',
      buttonMidiBinding: 'MIDI Bind',
      buttonMidiUnbound: 'Не привязано',
      buttonMidiBind: 'Bind',
      buttonMidiRebind: 'Bind',
      buttonIconMore: 'Ещё иконки',
      buttonIconLess: 'Скрыть иконки',
      buttonPanelStubTitle: 'Будущая панель настройки',
      buttonPanelStubText: 'Здесь позже появятся действия, режимы и дополнительные параметры кнопки.',
      titlePlaceholder: 'Название фейдера',
      remap: 'Bind',
      targets: 'Цели / приложения / устройства',
      addTarget: 'Добавить',
      noTargetAssigned: 'Нет цели',
      targetPlaceholder: 'Нажмите, чтобы добавить цель',
      removeTarget: 'Убрать цель',
      targetTitleIcon: 'Иконка у названия',
      useTargetName: 'Взять название',
      customSettings: 'Локальные настройки',
      globalSettingsHint: 'Этот фейдер использует глобальные настройки из Settings.',
      localFractionalNumbers: 'Показывать дробные числа',
      sidePanelTitle: 'Выбор цели',
      sidePanelSubtitle: 'Подготовленная встроенная панель для будущего выбора targets/apps/devices.',
      sidePanelEmpty: 'Доступные цели появятся здесь.',
      openTargetPanel: 'Открыть панель выбора',
      buttonStubTitle: 'Общий editor для кнопок',
      buttonStubText: 'Основа для preview, modal flow и side panel уже готова. Детальная настройка кнопок пока остаётся в legacy modal.'
    },
    buttons: {
      defaultLabel: 'Button',
      buttonLearnMissing: 'MIDI learn для кнопки пока не реализован.',
      standaloneLearnMissing: 'MIDI learn для отдельной кнопки пока не реализован.',
      standaloneLimit: 'Можно добавить максимум 24 отдельные кнопки.',
      channelLimit: 'В одном канале доступно только 4 кнопки.',
      standaloneEditorParked: 'Настройка standalone-кнопок пока припаркована.'
    },
    layout: {
      modeOn: 'Расклад',
      modeOff: 'Расклад',
      exitMode: 'Выйти из режима раскладки',
      addSpacer: 'Добавить разделитель',
      removeSpacer: 'Убрать разделитель',
      itemTypes: {
        channel: 'Канал',
        standaloneButton: 'Кнопка',
        spacer: 'Разделитель'
      }
    },
    channels: {
      defaultTitle: 'Канал {index}',
      unnamed: 'Без названия',
      configure: 'Настроить',
      bindToMixer: 'Bind',
      unboundWarning: 'Этот фейдер не привязан к MIDI-контроллеру. Он будет работать только через интерфейс.',
      channelNamePrompt: 'Название канала:',
      advancedControlChange: 'control_change (CC {control})',
      advancedControlChange14Bit: 'control_change_14bit (CC {control})',
      advancedPitchBend: 'pitch_bend (ch {channel})',
      advancedPitchwheel: 'pitchwheel (ch {channel})',
      advancedNrpn: 'NRPN ({parameterMsb}:{parameterLsb}, ch {channel})',
      advancedRpn: 'RPN ({parameterMsb}:{parameterLsb}, ch {channel})',
      addButton: 'Добавить'
    },
    midi: {
      initialized: 'WebMIDI инициализирован',
      unsupported: 'Web MIDI API не поддерживается',
      initFailed: 'Ошибка инициализации WebMIDI',
      moveFader: 'Подвигайте фейдер на MIDI-микшере, чтобы забиндить "{name}"',
      moveButton: 'Нажмите кнопку на MIDI-микшере, чтобы забиндить "{name}"',
      failedToDetect: 'Не удалось определить движение фейдера',
      bindCancelled: 'Бинд фейдера отменён',
      bindSuccess: 'Фейдер забинжен',
      buttonBindSuccess: 'Кнопка забинжена',
      selectDeviceFirst: 'Сначала выберите MIDI-устройство.',
      conflict: 'Этот контроллер уже используется каналом "{name}". Всё равно Bind?',
      buttonConflict: 'Этот контроллер уже используется другим элементом "{name}". Всё равно Bind?'
    },
    context: {
      edit: 'Изменить',
      select: 'Выделить',
      remap: 'Bind',
      delete: 'Удалить'
    },
    common: {
      cancel: 'Отмена',
      save: 'Сохранить'
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
      selectMidi: 'Find devices',
      scanningMidi: 'Scanning MIDI devices...',
      disableMidi: 'Turn off'
    },
    status: {
      notConnected: 'not connected',
      unsupported: 'unsupported',
      connectionFailed: 'connection failed',
      disabled: 'disabled',
      devices: '{count} device(s)'
    },
    menu: {
      tabs: {
        profiles: 'Profiles',
        plugins: 'Plugins',
        settings: 'Settings',
        account: 'Account'
      },
      comingSoonTitle: 'Coming soon',
      pluginsPlaceholder: 'Plugins section is not implemented yet.',
      accountPlaceholder: 'Account section is not implemented yet.'
    },
    settings: {
      sections: {
        faders: 'Faders',
        visual: 'Visual',
        volumeHud: 'Volume HUD',
        system: 'System',
        advanced: 'Advanced'
      },
      developerMode: 'Developer mode',
      advancedMode: 'Advanced mode',
      profileToolbarSwitcher: 'Profile switching in toolbar',
      volumeHudEnabled: 'Volume HUD',
      volumeHudPosition: 'HUD position',
      volumeHudOrientation: 'HUD orientation',
      volumeHudVisibleElements: 'Visible elements',
      volumeHudPreview: 'Preview',
      volumeHudPreviewTitle: 'FaderDeck',
      volumeHudPreviewSubtitle: 'Channel 1',
      volumeHudShowIcon: 'Application icon',
      volumeHudShowTitle: 'Target title',
      volumeHudShowSubtitle: 'Channel subtitle',
      volumeHudShowPercent: 'Volume percent',
      volumeHudShowMeter: 'Volume meter',
      volumeHudPositions: {
        bottomCenter: 'Bottom center',
        bottomLeft: 'Bottom left',
        bottomRight: 'Bottom right',
        topCenter: 'Top center',
        topLeft: 'Top left',
        topRight: 'Top right'
      },
      volumeHudOrientations: {
        horizontal: 'Horizontal',
        vertical: 'Vertical'
      },
      faderInterpolation: 'Fader interpolation',
      faderInterpolationHelp: 'Smooths the change between the starting and ending volume to reduce abrupt jumps, but may add a little latency.',
      softTakeover: 'Soft takeover',
      softTakeoverHelp: 'Incoming MIDI fader movement is ignored until the physical control reaches the current channel value. This helps prevent abrupt jumps after profile changes or layout switches.',
      softTakeoverThreshold: 'Pickup threshold',
      showFractionalNumbers: 'Show fractional values',
      showFractionalOnlyLow: 'Only for low values',
      volumeCurve: 'Volume curve',
      volumeCurveHelp: 'Volume changes along a curve instead of linearly, which gives finer control over perceived loudness.',
      curveEaseIn: 'Ease in',
      curveEaseOut: 'Ease out',
      curveEaseInOut: 'Ease in out',
      startOnBoot: 'Start on boot',
      language: 'Language',
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
    editor: {
      preview: 'Preview',
      close: 'Close',
      faderType: 'Fader',
      buttonType: 'Button',
      channelButtons: 'Channel buttons',
      addChannelButton: 'Add button',
      openButton: 'Open',
      openButtonPanel: 'Open button panel',
      removeChannelButton: 'Remove button',
      buttonPlacement: 'Placement',
      buttonPlacementBottom: 'Bottom',
      buttonPlacementSide: 'Side',
      buttonPanelTitle: 'Button settings',
      buttonPanelSubtitle: '',
      buttonPanelTargetButton: 'Channel button',
      buttonName: 'Name',
      buttonIcon: 'Icon',
      buttonAction: 'Action',
      buttonActionNone: 'No action',
      buttonIndicator: 'Indicator',
      buttonModePush: 'push',
      buttonModeToggle: 'toggle',
      buttonModeTrigger: 'trigger',
      buttonModeLink: 'Link',
      buttonContentDisplay: 'Show',
      buttonMetaDisplay: 'Bottom row',
      buttonContentDisplayIconTitle: 'Icon and title',
      buttonContentDisplayIconOnly: 'Icon only',
      buttonContentDisplayTitleOnly: 'Title only',
      buttonMetaDisplayActionIndicator: 'Action and indicator',
      buttonMetaDisplayActionOnly: 'Action only',
      buttonMetaDisplayIndicatorOnly: 'Indicator only',
      buttonActionMute: 'Mute',
      buttonActionSolo: 'Solo',
      buttonActionSetVolume: 'Set volume',
      buttonActionSendKey: 'Send key',
      buttonIndicatorToggle: 'Toggle',
      buttonIndicatorMeter: 'Peak meter',
      buttonIndicatorPress: 'Light on press',
      buttonKey: 'Key',
      buttonKeyPlaceholder: 'Press a key...',
      buttonKeyRequired: 'Choose a key for send key first',
      buttonSetVolumeValue: 'Volume',
      buttonMidiBinding: 'MIDI Bind',
      buttonMidiUnbound: 'Not bound',
      buttonMidiBind: 'Bind',
      buttonMidiRebind: 'Bind',
      buttonIconMore: 'More icons',
      buttonIconLess: 'Less icons',
      buttonPanelStubTitle: 'Future settings panel',
      buttonPanelStubText: 'Actions, modes, and extra button settings will appear here later.',
      titlePlaceholder: 'Fader name',
      remap: 'Bind',
      targets: 'Targets / apps / devices',
      addTarget: 'Add',
      noTargetAssigned: 'No target',
      targetPlaceholder: 'Click to add a target',
      removeTarget: 'Remove target',
      targetTitleIcon: 'Icon in title',
      useTargetName: 'Use target name',
      customSettings: 'Custom settings',
      globalSettingsHint: 'This fader uses the global settings from the Settings menu.',
      localFractionalNumbers: 'Show fractional values',
      sidePanelTitle: 'Select target',
      sidePanelSubtitle: 'Prepared built-in panel for future targets/apps/devices selection.',
      sidePanelEmpty: 'Available targets will appear here.',
      openTargetPanel: 'Open selector panel',
      buttonStubTitle: 'Shared button editor foundation',
      buttonStubText: 'Preview, modal flow, and side panel hooks are already prepared. Detailed button editing stays on the legacy modal for now.'
    },
    buttons: {
      defaultLabel: 'Button',
      buttonLearnMissing: 'Button MIDI learn is not implemented yet.',
      standaloneLearnMissing: 'Standalone button MIDI learn is not implemented yet.',
      standaloneLimit: 'You can add up to 24 standalone buttons.',
      channelLimit: 'Only 4 buttons are available per channel.',
      standaloneEditorParked: 'Standalone button editing is parked for now.'
    },
    layout: {
      modeOn: 'Layout',
      modeOff: 'Layout',
      exitMode: 'Exit layout edit mode',
      addSpacer: 'Add spacer',
      removeSpacer: 'Remove spacer',
      itemTypes: {
        channel: 'Channel',
        standaloneButton: 'Button',
        spacer: 'Spacer'
      }
    },
    channels: {
      defaultTitle: 'Channel {index}',
      unnamed: 'Untitled',
      configure: 'Configure',
      bindToMixer: 'Bind',
      unboundWarning: 'This fader is not bound to a MIDI control. It will only respond through the interface.',
      channelNamePrompt: 'Channel name:',
      advancedControlChange: 'control_change (CC {control})',
      advancedControlChange14Bit: 'control_change_14bit (CC {control})',
      advancedPitchBend: 'pitch_bend (ch {channel})',
      advancedPitchwheel: 'pitchwheel (ch {channel})',
      advancedNrpn: 'NRPN ({parameterMsb}:{parameterLsb}, ch {channel})',
      advancedRpn: 'RPN ({parameterMsb}:{parameterLsb}, ch {channel})',
      addButton: 'Add'
    },
    midi: {
      initialized: 'WebMIDI initialized',
      unsupported: 'Web MIDI API not supported',
      initFailed: 'WebMIDI initialization failed',
      moveFader: 'Move the fader for channel "{name}"',
      moveButton: 'Press the MIDI button for "{name}"',
      failedToDetect: 'Failed to detect fader movement',
      bindCancelled: 'Fader binding cancelled',
      bindSuccess: 'Fader bound',
      buttonBindSuccess: 'Button bound',
      selectDeviceFirst: 'Select a MIDI device first.',
      conflict: 'This controller is already used by channel "{name}". Bind anyway?',
      buttonConflict: 'This controller is already used by "{name}". Bind anyway?'
    },
    context: {
      edit: 'Edit',
      select: 'Select',
      remap: 'Bind',
      delete: 'Delete'
    },
    common: {
      cancel: 'Cancel',
      save: 'Save'
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
const languageStorage = window.languageStorage;
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
  const savedLanguage = languageStorage?.readLanguage('') || '';
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

  root.querySelectorAll('[data-i18n-tooltip]').forEach((element) => {
    element.dataset.tooltip = t(element.dataset.i18nTooltip);
    element.setAttribute('aria-label', t(element.dataset.i18nTooltip));
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
    languageStorage?.writeLanguage(nextLanguage);
  }

  applyTranslations();
  window.dispatchEvent(new CustomEvent('app:language-changed', {
    detail: { language: nextLanguage }
  }));
}

currentLanguage = getInitialLanguage();
document.documentElement.lang = currentLanguage;
