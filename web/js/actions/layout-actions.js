(function initLayoutActions(window) {
  function persistProfile() {
    return window.profileActions?.saveRendererProfileToLocal?.() || null;
  }

  function getLayoutItem(itemId) {
    return window.findLayoutItemState?.(itemId) || null;
  }

  function enterLayoutEditMode(meta = {}) {
    return window.patchLayoutEditorSessionState?.({
      enabled: true
    }, {
      type: 'layout-actions/enter-edit-mode',
      source: 'layout-actions',
      ...meta
    }) || null;
  }

  function exitLayoutEditMode(meta = {}) {
    return window.patchLayoutEditorSessionState?.({
      enabled: false,
      selectedItemId: null,
      hoveredItemId: null,
      dropPreview: null
    }, {
      type: 'layout-actions/exit-edit-mode',
      source: 'layout-actions',
      ...meta
    }) || null;
  }

  function toggleLayoutEditMode(meta = {}) {
    return (window.isLayoutEditModeEnabledState?.() ?? false)
      ? exitLayoutEditMode(meta)
      : enterLayoutEditMode(meta);
  }

  function selectLayoutItem(itemId, meta = {}) {
    const item = getLayoutItem(itemId);

    if (!item) {
      return null;
    }

    if (!(window.isLayoutEditModeEnabledState?.() ?? false)) {
      enterLayoutEditMode(meta);
    }

    window.clearLayoutDropPreviewState?.({
      source: 'layout-actions',
      ...meta
    });

    return window.setSelectedLayoutItemIdState?.(item.id, {
      type: 'layout-actions/select-item',
      source: 'layout-actions',
      itemId: item.id,
      ...meta
    }) || null;
  }

  function clearLayoutSelection(meta = {}) {
    return window.setSelectedLayoutItemIdState?.(null, {
      type: 'layout-actions/clear-selection',
      source: 'layout-actions',
      ...meta
    }) || null;
  }

  function hoverLayoutItem(itemId, meta = {}) {
    const item = itemId ? getLayoutItem(itemId) : null;

    return window.setHoveredLayoutItemIdState?.(item?.id || null, {
      type: 'layout-actions/hover-item',
      source: 'layout-actions',
      itemId: item?.id || null,
      ...meta
    }) || null;
  }

  function clearLayoutHover(meta = {}) {
    return window.setHoveredLayoutItemIdState?.(null, {
      type: 'layout-actions/clear-hover',
      source: 'layout-actions',
      ...meta
    }) || null;
  }

  function moveLayoutItem(itemId, targetIndex, options = {}, meta = {}) {
    const movedItem = window.moveLayoutItemState?.(itemId, targetIndex, options, {
      type: 'layout-actions/move-item',
      source: 'layout-actions',
      itemId,
      targetIndex,
      ...meta
    }) || null;

    if (!movedItem) {
      return null;
    }

    persistProfile();
    return movedItem;
  }

  function insertSpacer(options = {}, meta = {}) {
    const spacerItem = window.insertLayoutSpacerState?.(options, {
      type: 'layout-actions/insert-spacer',
      source: 'layout-actions',
      ...meta
    }) || null;

    if (!spacerItem) {
      return null;
    }

    persistProfile();
    selectLayoutItem(spacerItem.id, meta);
    return spacerItem;
  }

  function removeLayoutItem(itemId, meta = {}) {
    const layoutItem = getLayoutItem(itemId);

    if (!layoutItem || layoutItem.type !== window.LAYOUT_ITEM_TYPES?.spacer) {
      return null;
    }

    const removedItem = window.removeLayoutItemState?.(layoutItem.id, {
      type: 'layout-actions/remove-item',
      source: 'layout-actions',
      itemId: layoutItem.id,
      ...meta
    }) || null;

    if (!removedItem) {
      return null;
    }

    if ((window.getSelectedLayoutItemIdState?.() || null) === removedItem.id) {
      clearLayoutSelection(meta);
    }

    persistProfile();
    return removedItem;
  }

  window.layoutActions = {
    enterLayoutEditMode,
    exitLayoutEditMode,
    toggleLayoutEditMode,
    selectLayoutItem,
    clearLayoutSelection,
    hoverLayoutItem,
    clearLayoutHover,
    moveLayoutItem,
    insertSpacer,
    removeLayoutItem
  };
})(window);
