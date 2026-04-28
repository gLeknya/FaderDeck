(function initLayoutActions(window) {
  // Park marker: the editor foundation remains in the repo, but visible editor
  // flows are intentionally disabled until layout editing is resumed.
  function persistProfile() {
    return window.profileActions?.saveRendererProfileToLocal?.() || null;
  }

  function isLayoutEditorParked() {
    return window.isLayoutEditorParked?.() ?? true;
  }

  function getLayoutItem(itemId) {
    return window.findLayoutItemState?.(itemId) || null;
  }

  function getLayoutZoneItems(zone) {
    return window.getLayoutItemsByZoneState?.(zone) || [];
  }

  function enterLayoutEditMode(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (
      window.patchLayoutEditorSessionState?.(
        {
          enabled: true
        },
        {
          type: 'layout-actions/enter-edit-mode',
          source: 'layout-actions',
          ...meta
        }
      ) || null
    );
  }

  function exitLayoutEditMode(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (
      window.patchLayoutEditorSessionState?.(
        {
          enabled: false,
          selectedItemId: null,
          hoveredItemId: null,
          dragItemId: null,
          dropPreview: null
        },
        {
          type: 'layout-actions/exit-edit-mode',
          source: 'layout-actions',
          ...meta
        }
      ) || null
    );
  }

  function toggleLayoutEditMode(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (window.isLayoutEditModeEnabledState?.() ?? false)
      ? exitLayoutEditMode(meta)
      : enterLayoutEditMode(meta);
  }

  function selectLayoutItem(itemId, meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

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

    return (
      window.setSelectedLayoutItemIdState?.(item.id, {
        type: 'layout-actions/select-item',
        source: 'layout-actions',
        itemId: item.id,
        ...meta
      }) || null
    );
  }

  function clearLayoutSelection(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (
      window.setSelectedLayoutItemIdState?.(null, {
        type: 'layout-actions/clear-selection',
        source: 'layout-actions',
        ...meta
      }) || null
    );
  }

  function hoverLayoutItem(itemId, meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    const item = itemId ? getLayoutItem(itemId) : null;

    return (
      window.setHoveredLayoutItemIdState?.(item?.id || null, {
        type: 'layout-actions/hover-item',
        source: 'layout-actions',
        itemId: item?.id || null,
        ...meta
      }) || null
    );
  }

  function clearLayoutHover(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (
      window.setHoveredLayoutItemIdState?.(null, {
        type: 'layout-actions/clear-hover',
        source: 'layout-actions',
        ...meta
      }) || null
    );
  }

  function beginLayoutItemDrag(itemId, meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    const item = getLayoutItem(itemId);

    if (!item) {
      return null;
    }

    if (!(window.isLayoutEditModeEnabledState?.() ?? false)) {
      enterLayoutEditMode(meta);
    }

    window.patchLayoutEditorSessionState?.(
      {
        selectedItemId: item.id,
        dragItemId: item.id,
        dropPreview: null
      },
      {
        type: 'layout-actions/begin-drag',
        source: 'layout-actions',
        itemId: item.id,
        ...meta
      }
    );

    return item;
  }

  function previewLayoutDrop(target = {}, meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    const dragItemId = window.getDraggedLayoutItemIdState?.() || null;
    const dragItem = dragItemId ? getLayoutItem(dragItemId) : null;
    const targetItem = target.itemId ? getLayoutItem(target.itemId) : null;
    const targetZone = target.zone || targetItem?.zone || null;
    const targetPosition = ['before', 'after'].includes(target.position)
      ? target.position
      : null;

    if (
      !dragItem ||
      !targetItem ||
      !targetZone ||
      !targetPosition ||
      dragItem.zone !== targetZone ||
      targetItem.zone !== targetZone ||
      dragItem.id === targetItem.id
    ) {
      window.clearLayoutDropPreviewState?.({
        type: 'layout-actions/clear-drop-preview',
        source: 'layout-actions',
        ...meta
      });
      return null;
    }

    const nextPreview = {
      itemId: targetItem.id,
      zone: targetZone,
      position: targetPosition
    };

    return (
      window.setLayoutDropPreviewState?.(nextPreview, {
        type: 'layout-actions/preview-drop',
        source: 'layout-actions',
        itemId: targetItem.id,
        dragItemId: dragItem.id,
        ...meta
      }) || null
    );
  }

  function clearLayoutDropPreview(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (
      window.clearLayoutDropPreviewState?.({
        type: 'layout-actions/clear-drop-preview',
        source: 'layout-actions',
        ...meta
      }) || null
    );
  }

  function cancelLayoutItemDrag(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    return (
      window.patchLayoutEditorSessionState?.(
        {
          dragItemId: null,
          dropPreview: null
        },
        {
          type: 'layout-actions/cancel-drag',
          source: 'layout-actions',
          ...meta
        }
      ) || null
    );
  }

  function moveLayoutItem(itemId, targetIndex, options = {}, meta = {}) {
    const movedItem =
      window.moveLayoutItemState?.(itemId, targetIndex, options, {
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

  function commitLayoutDrop(meta = {}) {
    if (isLayoutEditorParked()) {
      return null;
    }

    const dragItemId = window.getDraggedLayoutItemIdState?.() || null;
    const dropPreview = window.getLayoutDropPreviewState?.() || null;
    const dragItem = dragItemId ? getLayoutItem(dragItemId) : null;
    const targetItem = dropPreview?.itemId
      ? getLayoutItem(dropPreview.itemId)
      : null;

    if (
      !dragItem ||
      !targetItem ||
      dragItem.zone !== targetItem.zone ||
      dragItem.zone !== dropPreview?.zone
    ) {
      cancelLayoutItemDrag(meta);
      return null;
    }

    const zoneItems = getLayoutZoneItems(dragItem.zone);
    const dragIndex = zoneItems.findIndex((item) => item.id === dragItem.id);
    const targetIndex = zoneItems.findIndex(
      (item) => item.id === targetItem.id
    );

    if (dragIndex === -1 || targetIndex === -1) {
      cancelLayoutItemDrag(meta);
      return null;
    }

    let nextIndex =
      dropPreview.position === 'after' ? targetIndex + 1 : targetIndex;

    if (dragIndex < nextIndex) {
      nextIndex -= 1;
    }

    const movedItem = moveLayoutItem(
      dragItem.id,
      nextIndex,
      {
        zone: dragItem.zone
      },
      meta
    );

    window.patchLayoutEditorSessionState?.(
      {
        selectedItemId: movedItem?.id || dragItem.id,
        dragItemId: null,
        dropPreview: null
      },
      {
        type: 'layout-actions/commit-drop',
        source: 'layout-actions',
        itemId: dragItem.id,
        ...meta
      }
    );

    return movedItem;
  }

  function insertSpacer(options = {}, meta = {}) {
    const spacerItem =
      window.insertLayoutSpacerState?.(options, {
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

    const removedItem =
      window.removeLayoutItemState?.(layoutItem.id, {
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
    beginLayoutItemDrag,
    previewLayoutDrop,
    clearLayoutDropPreview,
    cancelLayoutItemDrag,
    moveLayoutItem,
    commitLayoutDrop,
    insertSpacer,
    removeLayoutItem
  };
})(window);
