let profileEditingState = null;
let draggedProfileName = null;
let profileUiInitialized = false;
let profileRuntimeSyncInitialized = false;
let profileScrollController = null;
let profileScrollSyncFrame = null;
let profileScrollSyncTimeout = null;

function getProfileService() {
  return window.profileService || null;
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

function getProfileListScrollBar() {
  return document.getElementById('profileListScrollBar');
}

function getProfileListScrollTrack() {
  return document.getElementById('profileListScrollTrack');
}

function getProfileListScrollThumb() {
  return document.getElementById('profileListScrollThumb');
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

function getProfilesList() {
  return getProfilesListState?.() || [];
}

function getCurrentProfileName() {
  return getCurrentProfileNameRuntime?.() || '';
}

function getProfileByName(profileName) {
  return getProfileByNameState?.(profileName) || null;
}

function isProfileVisibleInToolbar(profileName) {
  return isProfileVisibleInToolbarState?.(profileName) ?? true;
}

function sanitizeProfileName(name = '') {
  return sanitizeProfileNameState?.(name) || String(name).trim();
}

function getUniqueDraftProfileName(baseLabel) {
  return getUniqueProfileDraftNameState?.(
    baseLabel,
    profileEditingState?.mode === 'create' ? [profileEditingState.originalName] : []
  ) || baseLabel;
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

function syncToolbarProfileSelect() {
  const select = getToolbarProfileSelect();

  if (!select) {
    return;
  }

  const visibleProfiles = getProfilesList().filter((profile) => isProfileVisibleInToolbar(profile.name));
  const currentProfileName = getCurrentProfileName();
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

function renderProfileRow(profile, options = {}) {
  const isEditing = profileEditingState
    && (
      (profileEditingState.mode === 'rename' && profileEditingState.originalName === profile.name)
      || (profileEditingState.mode === 'create' && profileEditingState.originalName === profile.name)
    );
  const isCurrent = getCurrentProfileName() === profile.name;
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
  const profileRows = [...draftProfiles, ...getProfilesList()];

  if (profileRows.length === 0) {
    list.innerHTML = `
      <div class="profiles-empty-state">
        <div class="profiles-empty-title">${t('profiles.emptyTitle')}</div>
        <div class="profiles-empty-text">${t('profiles.emptyText')}</div>
      </div>
    `;
    scheduleProfilesScrollSync();
    return;
  }

  list.innerHTML = profileRows
    .map((profile) => renderProfileRow(profile, {
      isDraft: profileEditingState?.mode === 'create' && profile.name === profileEditingState.originalName
    }))
    .join('');

  focusProfileInputIfNeeded();
  scheduleProfilesScrollSync();
}

function scheduleProfilesScrollSync() {
  profileScrollController?.scheduleSync?.();

  if (profileScrollSyncFrame) {
    cancelAnimationFrame(profileScrollSyncFrame);
  }

  if (profileScrollSyncTimeout) {
    clearTimeout(profileScrollSyncTimeout);
  }

  profileScrollSyncFrame = requestAnimationFrame(() => {
    profileScrollSyncFrame = null;
    profileScrollController?.scheduleSync?.();
    requestAnimationFrame(() => {
      profileScrollController?.scheduleSync?.();
    });
  });

  profileScrollSyncTimeout = window.setTimeout(() => {
    profileScrollSyncTimeout = null;
    profileScrollController?.scheduleSync?.();
  }, 320);
}

function setupProfilesScrollbar() {
  if (profileScrollController || typeof createAppScrollbar !== 'function') {
    return;
  }

  profileScrollController = createAppScrollbar({
    orientation: 'vertical',
    alwaysVisible: true,
    hideDelay: 1800,
    getScroller: getProfileListElement,
    getScrollbar: getProfileListScrollBar,
    getTrack: getProfileListScrollTrack,
    getThumb: getProfileListScrollThumb,
    getEnabled: () => (
      typeof isMenuOpen === 'function'
      && typeof getActiveMenuTab === 'function'
      && isMenuOpen()
      && getActiveMenuTab() === 'profiles'
    )
  });
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

async function loadProfileByName(profileName) {
  if (!profileName) {
    return;
  }

  try {
    await getProfileService()?.loadProfileByName?.(profileName);
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

  const nameCollision = getProfilesList().some((profile) => (
    profile.name === nextName && profile.name !== originalName
  ));

  if (nameCollision) {
    showToast('warn', t('profiles.nameExists'));
    focusProfileInputIfNeeded();
    return;
  }

  try {
    if (isCreate) {
      const result = await getProfileService()?.saveProfile?.(nextName);
      profileEditingState = null;
      showToast('success', t('profiles.saved', { name: result?.name || nextName }));
      return;
    }

    if (nextName === originalName) {
      cancelProfileEditing();
      return;
    }

    const result = await getProfileService()?.renameProfile?.(originalName, nextName);
    profileEditingState = null;
    showToast('success', t('profiles.renamed', { name: result?.name || nextName }));
  } catch (error) {
    console.error('commitProfileEditing error', error);
    showToast('error', isCreate ? t('profiles.saveFailed') : t('profiles.renameFailed'));
    focusProfileInputIfNeeded();
  }
}

async function deleteProfileByName(profileName) {
  if (!profileName) {
    return;
  }

  const confirmed = confirm(t('profiles.deleteConfirm', { name: profileName }));

  if (!confirmed) {
    return;
  }

  try {
    await getProfileService()?.deleteProfile?.(profileName);
    showToast('success', t('profiles.deleted', { name: profileName }));
  } catch (error) {
    console.error('deleteProfileByName error', error);
    showToast('error', t('profiles.deleteFailed'));
  }
}

async function revealProfileInFolder(profileName) {
  try {
    await getProfileService()?.revealProfileInFolder?.(profileName);
  } catch (error) {
    console.error('revealProfileInFolder error', error);
  }
}

async function openProfilesFolder() {
  try {
    await getProfileService()?.openProfilesFolder?.();
  } catch (error) {
    console.error('openProfilesFolder error', error);
  }
}

async function importProfileFromFile() {
  try {
    const result = await getProfileService()?.importProfileFromFile?.();

    if (!result || result.canceled) {
      return;
    }

    closeProfileImportMenu();
    showToast('success', t('profiles.imported', { name: result.name }));
  } catch (error) {
    console.error('importProfileFromFile error', error);
    showToast('error', t('profiles.importFailed'));
  }
}

function toggleProfileToolbarVisibility(profileName, visible) {
  toggleProfileToolbarVisibilityState?.(profileName, visible, {
    source: 'profiles-ui'
  });
}

function reorderProfiles(draggedName, targetName) {
  reorderProfilesState?.(draggedName, targetName, {
    source: 'profiles-ui'
  });
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

  setupProfilesScrollbar();

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
  initProfileStore?.();

  if (!profileRuntimeSyncInitialized) {
    subscribeProfileState?.(() => {
      syncToolbarProfileSelect();
      renderProfilesPanel();
    });
    profileRuntimeSyncInitialized = true;
  }

  bindProfilesUi();
  syncToolbarProfileSelect();
  renderProfilesPanel();

  try {
    await getProfileService()?.init?.();
  } catch (error) {
    console.error('initProfilesUi error', error);
    showToast('error', t('profiles.failedToLoad'));
  }
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

window.scheduleProfilesScrollSync = scheduleProfilesScrollSync;
