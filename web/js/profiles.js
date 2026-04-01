const PROFILE_NAME_SANITIZE_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const PROFILE_UI_STORAGE_KEYS = {
  currentProfile: 'faderdeck_current_profile',
  preferences: 'faderdeck_profile_preferences'
};

let profilesListState = [];
let currentProfileName = localStorage.getItem(PROFILE_UI_STORAGE_KEYS.currentProfile) || '';
let profilePreferences = loadProfilePreferences();
let profileEditingState = null;
let draggedProfileName = null;
let profileUiInitialized = false;

function loadProfilePreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_UI_STORAGE_KEYS.preferences) || '{}');
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      toolbarVisible: parsed.toolbarVisible && typeof parsed.toolbarVisible === 'object'
        ? parsed.toolbarVisible
        : {}
    };
  } catch (error) {
    console.error('loadProfilePreferences error', error);
    return { order: [], toolbarVisible: {} };
  }
}

function saveProfilePreferences() {
  localStorage.setItem(PROFILE_UI_STORAGE_KEYS.preferences, JSON.stringify(profilePreferences));
}

function sanitizeProfileName(name = '') {
  return String(name)
    .replace(PROFILE_NAME_SANITIZE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getProfileListElement() {
  return document.getElementById('profileList');
}

function getToolbarProfileSelect() {
  return document.getElementById('toolbarProfileSelect');
}

function getToolbarProfilePicker() {
  return document.querySelector('.toolbar-profile-picker');
}

function getProfileImportMenu() {
  return document.getElementById('profileImportMenu');
}

function isProfileVisibleInToolbar(name) {
  return profilePreferences.toolbarVisible[name] !== false;
}

function setCurrentProfile(name) {
  currentProfileName = name || '';

  if (currentProfileName) {
    localStorage.setItem(PROFILE_UI_STORAGE_KEYS.currentProfile, currentProfileName);
  } else {
    localStorage.removeItem(PROFILE_UI_STORAGE_KEYS.currentProfile);
  }

  syncToolbarProfileSelect();
  renderProfilesPanel();
}

function syncProfilePreferenceState(profileNames) {
  const existingNames = new Set(profileNames);

  profilePreferences.order = [
    ...profilePreferences.order.filter((name) => existingNames.has(name)),
    ...profileNames.filter((name) => !profilePreferences.order.includes(name))
  ];

  Object.keys(profilePreferences.toolbarVisible).forEach((name) => {
    if (!existingNames.has(name)) {
      delete profilePreferences.toolbarVisible[name];
    }
  });

  profileNames.forEach((name) => {
    if (!(name in profilePreferences.toolbarVisible)) {
      profilePreferences.toolbarVisible[name] = true;
    }
  });

  saveProfilePreferences();
}

function sortProfiles(profiles) {
  const orderIndex = new Map(profilePreferences.order.map((name, index) => [name, index]));

  return [...profiles].sort((left, right) => {
    const leftIndex = orderIndex.has(left.name) ? orderIndex.get(left.name) : Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndex.has(right.name) ? orderIndex.get(right.name) : Number.MAX_SAFE_INTEGER;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return (right.modified || 0) - (left.modified || 0) || left.name.localeCompare(right.name);
  });
}

function getUniqueDraftProfileName(baseLabel) {
  const taken = new Set([
    ...profilesListState.map((profile) => profile.name),
    profileEditingState?.mode === 'create' ? profileEditingState.originalName : null
  ].filter(Boolean));

  const safeBase = sanitizeProfileName(baseLabel) || 'Profile';

  if (!taken.has(safeBase)) {
    return safeBase;
  }

  let index = 2;

  while (taken.has(`${safeBase} ${index}`)) {
    index += 1;
  }

  return `${safeBase} ${index}`;
}

function ensureProfileOrder(name, options = {}) {
  profilePreferences.order = profilePreferences.order.filter((item) => item !== name);

  if (options.prepend) {
    profilePreferences.order.unshift(name);
  } else {
    profilePreferences.order.push(name);
  }

  profilePreferences.toolbarVisible[name] = options.visibleInToolbar ?? true;
  saveProfilePreferences();
}

function renameProfilePreferences(oldName, newName) {
  profilePreferences.order = profilePreferences.order.map((item) => (
    item === oldName ? newName : item
  ));

  if (oldName in profilePreferences.toolbarVisible) {
    profilePreferences.toolbarVisible[newName] = profilePreferences.toolbarVisible[oldName];
    delete profilePreferences.toolbarVisible[oldName];
  } else if (!(newName in profilePreferences.toolbarVisible)) {
    profilePreferences.toolbarVisible[newName] = true;
  }

  saveProfilePreferences();
}

function removeProfilePreferences(name) {
  profilePreferences.order = profilePreferences.order.filter((item) => item !== name);
  delete profilePreferences.toolbarVisible[name];
  saveProfilePreferences();
}

function captureProfileSnapshot(profileName = '') {
  return JSON.parse(JSON.stringify({
    meta: {
      name: profileName
    },
    channels,
    standaloneButtons: standaloneButtonsList,
    settings: getCurrentMidiSelectionSettings?.() || {}
  }));
}

function applyProfileData(profileName, profileData) {
  channels = Array.isArray(profileData?.channels) ? profileData.channels : [];
  standaloneButtonsList = Array.isArray(profileData?.standaloneButtons)
    ? profileData.standaloneButtons
    : [];

  const midiInput = document.getElementById('midiInput');

  if (midiInput) {
    applySavedMidiInputSelection?.(
      profileData?.settings?.midiInputId || '',
      profileData?.settings?.midiInputName || ''
    );
  }

  renderMixer();
  renderStandaloneButtons();
  saveProfileToLocal();
  setCurrentProfile(profileName);
  scheduleContentMetricsUpdate();
}

function getProfileByName(name) {
  return profilesListState.find((profile) => profile.name === name) || null;
}

function syncToolbarProfileSelect() {
  const select = getToolbarProfileSelect();

  if (!select) {
    return;
  }

  const visibleProfiles = profilesListState.filter((profile) => isProfileVisibleInToolbar(profile.name));
  const hasCurrentVisible = visibleProfiles.some((profile) => profile.name === currentProfileName);
  const placeholderSelected = !currentProfileName || !hasCurrentVisible;

  select.innerHTML = `
    <option value="" ${placeholderSelected ? 'selected' : ''}>
      ${t('profiles.toolbarPlaceholder')}
    </option>
    ${visibleProfiles.map((profile) => `
      <option value="${escapeHtml(profile.name)}" ${profile.name === currentProfileName ? 'selected' : ''}>
        ${escapeHtml(profile.name)}
      </option>
    `).join('')}
  `;
  enhanceCustomSelects?.(select);
  syncToolbarProfilePickerVisibility();
}

function syncToolbarProfilePickerVisibility() {
  const picker = getToolbarProfilePicker();

  if (!picker) {
    return;
  }

  const isEnabled = typeof isToolbarProfilePickerEnabled === 'function'
    ? isToolbarProfilePickerEnabled()
    : true;
  picker.classList.toggle('hidden', !isEnabled);
}

function renderProfileRow(profile, options = {}) {
  const isEditing = profileEditingState
    && (
      (profileEditingState.mode === 'rename' && profileEditingState.originalName === profile.name)
      || (profileEditingState.mode === 'create' && profileEditingState.originalName === profile.name)
    );
  const isCurrent = currentProfileName === profile.name;
  const nameMarkup = isEditing
    ? `
      <input
        class="profile-name-input"
        data-profile-input="true"
        data-profile-original-name="${escapeHtml(profile.name)}"
        value="${escapeHtml(profileEditingState.value)}"
        maxlength="80"
        spellcheck="false"
      >
    `
    : `
      <button class="profile-name-button" type="button" data-profile-load="${escapeHtml(profile.name)}">
        ${escapeHtml(profile.name)}
      </button>
    `;

  return `
    <div
      class="profile-row ${isCurrent ? 'current' : ''} ${options.isDraft ? 'draft' : ''}"
      data-profile-name="${escapeHtml(profile.name)}"
      draggable="${isEditing ? 'false' : 'true'}"
    >
      <div class="profile-drag-handle" data-profile-drag="true" aria-hidden="true">
        <span></span><span></span>
        <span></span><span></span>
        <span></span><span></span>
      </div>

      <label class="profile-toolbar-visibility" title="${t('profiles.showInToolbarTitle')}">
        <input
          type="checkbox"
          data-profile-toolbar-toggle="${escapeHtml(profile.name)}"
          ${isProfileVisibleInToolbar(profile.name) ? 'checked' : ''}
        >
        <span></span>
      </label>

      <div class="profile-name-slot">
        ${nameMarkup}
      </div>

      <div class="profile-actions" role="group" aria-label="${t('profiles.itemActions')}">
        <button
          class="profile-action-button"
          type="button"
          data-profile-action="reveal"
          data-profile-name="${escapeHtml(profile.name)}"
          title="${t('profiles.revealInFolder')}"
        >
          ${createFolderIconMarkup()}
        </button>
        <button
          class="profile-action-button"
          type="button"
          data-profile-action="upload"
          data-profile-name="${escapeHtml(profile.name)}"
          title="${t('profiles.uploadToSite')}"
        >
          ${createUploadIconMarkup()}
        </button>
        <button
          class="profile-action-button profile-action-danger"
          type="button"
          data-profile-action="delete"
          data-profile-name="${escapeHtml(profile.name)}"
          title="${t('profiles.delete')}"
        >
          ${createDeleteIconMarkup()}
        </button>
      </div>
    </div>
  `;
}

function renderProfilesPanel() {
  const list = getProfileListElement();

  if (!list) {
    return;
  }

  const draftProfiles = profileEditingState?.mode === 'create'
    ? [{
      name: profileEditingState.originalName,
      path: '',
      modified: Date.now()
    }]
    : [];
  const profileRows = [...draftProfiles, ...profilesListState];

  if (profileRows.length === 0) {
    list.innerHTML = `
      <div class="profiles-empty-state">
        <div class="profiles-empty-title">${t('profiles.emptyTitle')}</div>
        <div class="profiles-empty-text">${t('profiles.emptyText')}</div>
      </div>
    `;
    return;
  }

  list.innerHTML = profileRows
    .map((profile) => renderProfileRow(profile, {
      isDraft: profileEditingState?.mode === 'create' && profile.name === profileEditingState.originalName
    }))
    .join('');

  focusProfileInputIfNeeded();
}

function focusProfileInputIfNeeded() {
  if (!profileEditingState) {
    return;
  }

  requestAnimationFrame(() => {
    const input = document.querySelector('.profile-name-input[data-profile-input="true"]');

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  });
}

async function refreshProfilesData(options = {}) {
  const api = getApi();

  if (!api?.list_profiles) {
    return;
  }

  try {
    const response = await api.list_profiles();

    if (!response?.success) {
      throw new Error(response?.error || 'list_profiles_failed');
    }

    const normalizedProfiles = Array.isArray(response.profiles)
      ? response.profiles.map((profile) => ({
        name: profile.name,
        path: profile.path,
        modified: profile.modified || 0,
        meta: profile.meta || {}
      }))
      : [];

    syncProfilePreferenceState(normalizedProfiles.map((profile) => profile.name));
    profilesListState = sortProfiles(normalizedProfiles);

    if (currentProfileName && !profilesListState.some((profile) => profile.name === currentProfileName)) {
      setCurrentProfile('');
    } else {
      syncToolbarProfileSelect();
      renderProfilesPanel();
    }

    if (options.toastKey) {
      showToast('success', t(options.toastKey, options.toastParams || {}));
    }
  } catch (error) {
    console.error('refreshProfilesData error', error);
    showToast('error', t('profiles.failedToLoad'));
  }
}

async function loadProfileByName(profileName) {
  const api = getApi();

  if (!api?.load_profile || !profileName) {
    return;
  }

  try {
    const response = await api.load_profile(profileName);

    if (!response?.success) {
      throw new Error(response?.error || 'load_profile_failed');
    }

    applyProfileData(profileName, response.data);
    showToast('success', t('profiles.loaded', { name: profileName }));
  } catch (error) {
    console.error('loadProfileByName error', error);
    showToast('error', t('profiles.loadFailed', { name: profileName }));
  }
}

function startCreateProfileFlow() {
  const draftName = getUniqueDraftProfileName(t('profiles.newProfile'));
  profileEditingState = {
    mode: 'create',
    originalName: draftName,
    value: draftName
  };
  renderProfilesPanel();
}

function startRenameProfileFlow(profileName) {
  profileEditingState = {
    mode: 'rename',
    originalName: profileName,
    value: profileName
  };
  renderProfilesPanel();
}

function cancelProfileEditing() {
  profileEditingState = null;
  renderProfilesPanel();
}

async function commitProfileEditing() {
  if (!profileEditingState) {
    return;
  }

  const api = getApi();
  const nextName = sanitizeProfileName(profileEditingState.value);
  const originalName = profileEditingState.originalName;
  const isCreate = profileEditingState.mode === 'create';

  if (!nextName) {
    if (isCreate) {
      cancelProfileEditing();
      return;
    }

    showToast('warn', t('profiles.emptyName'));
    focusProfileInputIfNeeded();
    return;
  }

  const nameCollision = profilesListState.some((profile) => (
    profile.name === nextName && profile.name !== originalName
  ));

  if (nameCollision) {
    showToast('warn', t('profiles.nameExists'));
    focusProfileInputIfNeeded();
    return;
  }

  try {
    if (isCreate) {
      const response = await api.save_profile(nextName, captureProfileSnapshot(nextName));

      if (!response?.success) {
        throw new Error(response?.error || 'save_profile_failed');
      }

      ensureProfileOrder(response.name || nextName, { prepend: true, visibleInToolbar: true });
      profileEditingState = null;
      await refreshProfilesData({
        toastKey: 'profiles.saved',
        toastParams: { name: response.name || nextName }
      });
      setCurrentProfile(response.name || nextName);
      return;
    }

    if (nextName === originalName) {
      cancelProfileEditing();
      return;
    }

    const response = await api.rename_profile(originalName, nextName);

    if (!response?.success) {
      throw new Error(response?.error || 'rename_profile_failed');
    }

    renameProfilePreferences(originalName, response.name || nextName);

    if (currentProfileName === originalName) {
      setCurrentProfile(response.name || nextName);
    }

    profileEditingState = null;
    await refreshProfilesData({
      toastKey: 'profiles.renamed',
      toastParams: { name: response.name || nextName }
    });
  } catch (error) {
    console.error('commitProfileEditing error', error);
    showToast('error', isCreate ? t('profiles.saveFailed') : t('profiles.renameFailed'));
    focusProfileInputIfNeeded();
  }
}

async function deleteProfileByName(profileName) {
  const api = getApi();

  if (!api?.delete_profile || !profileName) {
    return;
  }

  const confirmed = confirm(t('profiles.deleteConfirm', { name: profileName }));

  if (!confirmed) {
    return;
  }

  try {
    const response = await api.delete_profile(profileName);

    if (!response?.success) {
      throw new Error(response?.error || 'delete_profile_failed');
    }

    removeProfilePreferences(profileName);

    if (currentProfileName === profileName) {
      setCurrentProfile('');
    }

    await refreshProfilesData({
      toastKey: 'profiles.deleted',
      toastParams: { name: profileName }
    });
  } catch (error) {
    console.error('deleteProfileByName error', error);
    showToast('error', t('profiles.deleteFailed'));
  }
}

async function revealProfileInFolder(profileName) {
  const api = getApi();
  const profile = getProfileByName(profileName);

  if (!api?.show_profile_in_folder || !profile?.path) {
    return;
  }

  await api.show_profile_in_folder(profile.path);
}

async function openProfilesFolder() {
  const api = getApi();

  if (!api?.open_profiles_folder) {
    return;
  }

  await api.open_profiles_folder();
}

async function importProfileFromFile() {
  const api = getApi();

  if (!api?.pick_profile_file || !api?.import_profile) {
    return;
  }

  try {
    const selection = await api.pick_profile_file();

    if (selection?.canceled || !selection?.filePath) {
      return;
    }

    const response = await api.import_profile(selection.filePath);

    if (!response?.success) {
      throw new Error(response?.error || 'import_profile_failed');
    }

    ensureProfileOrder(response.name, { prepend: true, visibleInToolbar: true });
    closeProfileImportMenu();
    await refreshProfilesData({
      toastKey: 'profiles.imported',
      toastParams: { name: response.name }
    });
  } catch (error) {
    console.error('importProfileFromFile error', error);
    showToast('error', t('profiles.importFailed'));
  }
}

function toggleProfileToolbarVisibility(profileName, visible) {
  profilePreferences.toolbarVisible[profileName] = visible;
  saveProfilePreferences();
  syncToolbarProfileSelect();
  renderProfilesPanel();
}

function reorderProfiles(draggedName, targetName) {
  if (!draggedName || !targetName || draggedName === targetName) {
    return;
  }

  const nextOrder = profilePreferences.order.filter((name) => name !== draggedName);
  const targetIndex = nextOrder.indexOf(targetName);

  if (targetIndex === -1) {
    nextOrder.push(draggedName);
  } else {
    nextOrder.splice(targetIndex, 0, draggedName);
  }

  profilePreferences.order = nextOrder;
  saveProfilePreferences();
  profilesListState = sortProfiles(profilesListState);
  syncToolbarProfileSelect();
  renderProfilesPanel();
}

function closeProfileImportMenu() {
  getProfileImportMenu()?.classList.add('hidden');
}

function toggleProfileImportMenu() {
  getProfileImportMenu()?.classList.toggle('hidden');
}

function handleProfilesListClick(event) {
  const actionButton = event.target.closest('[data-profile-action]');
  const loadButton = event.target.closest('[data-profile-load]');
  const importAction = event.target.closest('[data-profile-import-action]');

  if (actionButton) {
    const profileName = actionButton.dataset.profileName;
    const action = actionButton.dataset.profileAction;

    if (action === 'delete') {
      deleteProfileByName(profileName);
    } else if (action === 'reveal') {
      revealProfileInFolder(profileName);
    } else if (action === 'upload') {
      showToast('warn', t('profiles.uploadSoon'));
    }

    return;
  }

  if (loadButton) {
    loadProfileByName(loadButton.dataset.profileLoad);
    return;
  }

  if (importAction) {
    const action = importAction.dataset.profileImportAction;

    if (action === 'file') {
      importProfileFromFile();
    } else if (action === 'site') {
      closeProfileImportMenu();
      showToast('warn', t('profiles.importFromSiteSoon'));
    }
  }
}

function handleProfilesListChange(event) {
  const toggle = event.target.closest('[data-profile-toolbar-toggle]');

  if (!toggle) {
    return;
  }

  toggleProfileToolbarVisibility(toggle.dataset.profileToolbarToggle, toggle.checked);
}

function handleProfilesListDoubleClick(event) {
  const loadButton = event.target.closest('[data-profile-load]');

  if (!loadButton) {
    return;
  }

  startRenameProfileFlow(loadButton.dataset.profileLoad);
}

function handleProfilesListInput(event) {
  const input = event.target.closest('[data-profile-input]');

  if (!input || !profileEditingState) {
    return;
  }

  profileEditingState.value = input.value;
}

function handleProfilesListKeydown(event) {
  const input = event.target.closest('[data-profile-input]');

  if (!input) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    commitProfileEditing();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    cancelProfileEditing();
  }
}

function handleProfilesListFocusOut(event) {
  if (!event.target.closest('[data-profile-input]')) {
    return;
  }

  requestAnimationFrame(() => {
    const nextTarget = event.relatedTarget || document.activeElement;

    if (nextTarget?.closest('[data-profile-input]')) {
      return;
    }

    commitProfileEditing();
  });
}

function handleProfilesDragStart(event) {
  const row = event.target.closest('.profile-row');

  if (!row || profileEditingState) {
    event.preventDefault();
    return;
  }

  draggedProfileName = row.dataset.profileName;
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedProfileName);
}

function handleProfilesDragOver(event) {
  const row = event.target.closest('.profile-row');

  if (!row || !draggedProfileName || row.dataset.profileName === draggedProfileName) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  document.querySelectorAll('.profile-row.drag-over').forEach((element) => {
    element.classList.remove('drag-over');
  });
  row.classList.add('drag-over');
}

function handleProfilesDrop(event) {
  const row = event.target.closest('.profile-row');

  if (!row || !draggedProfileName) {
    return;
  }

  event.preventDefault();
  reorderProfiles(draggedProfileName, row.dataset.profileName);
  clearProfileDragState();
}

function clearProfileDragState() {
  draggedProfileName = null;
  document.querySelectorAll('.profile-row.dragging, .profile-row.drag-over').forEach((element) => {
    element.classList.remove('dragging', 'drag-over');
  });
}

function bindProfilesUi() {
  if (profileUiInitialized) {
    return;
  }

  getToolbarProfileSelect()?.addEventListener('change', (event) => {
    if (!event.target.value) {
      return;
    }

    loadProfileByName(event.target.value);
  });

  document.getElementById('saveCurrentProfileButton')?.addEventListener('click', startCreateProfileFlow);
  document.getElementById('openProfilesFolderButton')?.addEventListener('click', openProfilesFolder);
  document.getElementById('profileImportToggle')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleProfileImportMenu();
  });

  const profileList = getProfileListElement();

  profileList?.addEventListener('click', handleProfilesListClick);
  profileList?.addEventListener('change', handleProfilesListChange);
  profileList?.addEventListener('dblclick', handleProfilesListDoubleClick);
  profileList?.addEventListener('input', handleProfilesListInput);
  profileList?.addEventListener('keydown', handleProfilesListKeydown);
  profileList?.addEventListener('focusout', handleProfilesListFocusOut);
  profileList?.addEventListener('dragstart', handleProfilesDragStart);
  profileList?.addEventListener('dragover', handleProfilesDragOver);
  profileList?.addEventListener('drop', handleProfilesDrop);
  profileList?.addEventListener('dragend', clearProfileDragState);

  getProfileImportMenu()?.addEventListener('click', handleProfilesListClick);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.profile-import-wrap')) {
      closeProfileImportMenu();
    }
  });

  profileUiInitialized = true;
}

function refreshProfilesLanguage() {
  syncToolbarProfileSelect();
  renderProfilesPanel();
}

async function initProfilesUi() {
  bindProfilesUi();
  syncToolbarProfileSelect();
  renderProfilesPanel();
  await refreshProfilesData();
}

function createFolderIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9L11 6H18.5A2.5 2.5 0 0 1 21 8.5V16.5A2.5 2.5 0 0 1 18.5 19H5.5A2.5 2.5 0 0 1 3 16.5V6.5Z"></path>
    </svg>
  `;
}

function createUploadIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3L17 8H14V14H10V8H7L12 3ZM5 16H19V20H5V16Z"></path>
    </svg>
  `;
}

function createDeleteIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H15L16 6H20V8H4V6H8L9 4ZM7 10H9V18H7V10ZM11 10H13V18H11V10ZM15 10H17V18H15V10Z"></path>
    </svg>
  `;
}
