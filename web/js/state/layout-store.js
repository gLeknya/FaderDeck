(function initLayoutStore(window) {
  // Layout editor foundation is intentionally parked for now.
  // Persisted layout structure stays active, but visible editor UI and
  // interaction wiring should remain disabled until a future phase re-enables it.
  window.LAYOUT_EDITOR_PARKED = true;

  const LAYOUT_ZONES = Object.freeze({
    mixer: 'mixer',
    standalone: 'standalone'
  });

  const LAYOUT_ZONE_ORDER = Object.freeze([
    LAYOUT_ZONES.mixer,
    LAYOUT_ZONES.standalone
  ]);

  const LAYOUT_ITEM_TYPES = Object.freeze({
    channel: 'channel',
    standaloneButton: 'standalone-button',
    spacer: 'spacer'
  });

  const DEFAULT_LAYOUT_STATE = Object.freeze({
    items: []
  });

  const DEFAULT_LAYOUT_EDITOR_SESSION_STATE = Object.freeze({
    enabled: false,
    selectedItemId: null,
    hoveredItemId: null,
    dragItemId: null,
    dropPreview: null
  });

  function createEmptyLayoutState() {
    return {
      items: []
    };
  }

  function createDefaultLayoutEditorSessionState() {
    return {
      enabled: false,
      selectedItemId: null,
      hoveredItemId: null,
      dragItemId: null,
      dropPreview: null
    };
  }

  function isLayoutEditorParked() {
    return window.LAYOUT_EDITOR_PARKED !== false;
  }

  function isKnownLayoutZone(zone) {
    return LAYOUT_ZONE_ORDER.includes(zone);
  }

  function normalizeLayoutZone(zone, fallback = LAYOUT_ZONES.mixer) {
    return isKnownLayoutZone(zone) ? zone : fallback;
  }

  function parseLayoutEntityId(entityId) {
    const parsedValue = Number.parseInt(entityId, 10);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  function createGeneratedLayoutItemId(prefix = 'item') {
    return `layout-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  function normalizeSpacerSize(size) {
    return Math.max(1, Math.min(12, Number.parseInt(size, 10) || 1));
  }

  function isEntityLayoutItemType(type) {
    return (
      type === LAYOUT_ITEM_TYPES.channel ||
      type === LAYOUT_ITEM_TYPES.standaloneButton
    );
  }

  function getDefaultZoneForLayoutType(type) {
    if (type === LAYOUT_ITEM_TYPES.standaloneButton) {
      return LAYOUT_ZONES.standalone;
    }

    return LAYOUT_ZONES.mixer;
  }

  function createEntityLayoutItem(type, entityId, options = {}) {
    if (!isEntityLayoutItemType(type)) {
      return null;
    }

    const normalizedEntityId = parseLayoutEntityId(entityId);

    if (normalizedEntityId === null) {
      return null;
    }

    return {
      id: String(options.id || `layout-${type}-${normalizedEntityId}`),
      type,
      zone: getDefaultZoneForLayoutType(type),
      entityId: normalizedEntityId
    };
  }

  function createSpacerLayoutItem(options = {}) {
    return {
      id: String(options.id || createGeneratedLayoutItemId('spacer')),
      type: LAYOUT_ITEM_TYPES.spacer,
      zone: normalizeLayoutZone(options.zone, LAYOUT_ZONES.mixer),
      entityId: null,
      size: normalizeSpacerSize(options.size)
    };
  }

  function normalizeLayoutItem(item = {}) {
    const type = String(item.type || '').trim();

    if (type === LAYOUT_ITEM_TYPES.spacer) {
      return createSpacerLayoutItem(item);
    }

    if (
      type === LAYOUT_ITEM_TYPES.channel ||
      type === LAYOUT_ITEM_TYPES.standaloneButton
    ) {
      return createEntityLayoutItem(type, item.entityId, item);
    }

    return null;
  }

  function getLayoutEntityKey(type, entityId) {
    return `${type}:${entityId}`;
  }

  function getLayoutEntities(entities = {}) {
    return {
      channels: Array.isArray(entities.channels) ? entities.channels : [],
      standaloneButtons: Array.isArray(entities.standaloneButtons)
        ? entities.standaloneButtons
        : []
    };
  }

  function createDefaultLayoutItems(entities = {}) {
    const normalizedEntities = getLayoutEntities(entities);

    return [
      ...normalizedEntities.channels
        .map((channel) =>
          createEntityLayoutItem(LAYOUT_ITEM_TYPES.channel, channel.id)
        )
        .filter(Boolean),
      ...normalizedEntities.standaloneButtons
        .map((button) =>
          createEntityLayoutItem(LAYOUT_ITEM_TYPES.standaloneButton, button.id)
        )
        .filter(Boolean)
    ];
  }

  function createLayoutItemsByZone() {
    return {
      [LAYOUT_ZONES.mixer]: [],
      [LAYOUT_ZONES.standalone]: []
    };
  }

  function combineLayoutItemsByZone(itemsByZone) {
    return LAYOUT_ZONE_ORDER.flatMap((zone) => itemsByZone[zone] || []);
  }

  function reconcileLayoutItems(items, entities = {}) {
    const normalizedEntities = getLayoutEntities(entities);
    const itemsByZone = createLayoutItemsByZone();
    const availableEntityKeys = new Set([
      ...normalizedEntities.channels.map((channel) =>
        getLayoutEntityKey(LAYOUT_ITEM_TYPES.channel, channel.id)
      ),
      ...normalizedEntities.standaloneButtons.map((button) =>
        getLayoutEntityKey(LAYOUT_ITEM_TYPES.standaloneButton, button.id)
      )
    ]);
    const renderedEntityKeys = new Set();

    if (Array.isArray(items)) {
      items.forEach((item) => {
        const normalizedItem = normalizeLayoutItem(item);

        if (!normalizedItem) {
          return;
        }

        if (isEntityLayoutItemType(normalizedItem.type)) {
          const entityKey = getLayoutEntityKey(
            normalizedItem.type,
            normalizedItem.entityId
          );

          if (
            !availableEntityKeys.has(entityKey) ||
            renderedEntityKeys.has(entityKey)
          ) {
            return;
          }

          renderedEntityKeys.add(entityKey);
        }

        itemsByZone[normalizedItem.zone].push(normalizedItem);
      });
    }

    normalizedEntities.channels.forEach((channel) => {
      const entityKey = getLayoutEntityKey(
        LAYOUT_ITEM_TYPES.channel,
        channel.id
      );

      if (renderedEntityKeys.has(entityKey)) {
        return;
      }

      renderedEntityKeys.add(entityKey);
      itemsByZone[LAYOUT_ZONES.mixer].push(
        createEntityLayoutItem(LAYOUT_ITEM_TYPES.channel, channel.id)
      );
    });

    normalizedEntities.standaloneButtons.forEach((button) => {
      const entityKey = getLayoutEntityKey(
        LAYOUT_ITEM_TYPES.standaloneButton,
        button.id
      );

      if (renderedEntityKeys.has(entityKey)) {
        return;
      }

      renderedEntityKeys.add(entityKey);
      itemsByZone[LAYOUT_ZONES.standalone].push(
        createEntityLayoutItem(LAYOUT_ITEM_TYPES.standaloneButton, button.id)
      );
    });

    return combineLayoutItemsByZone(itemsByZone);
  }

  function normalizeLayoutState(layout = {}, entities = {}) {
    return {
      items: reconcileLayoutItems(layout?.items, entities)
    };
  }

  function normalizeLayoutDropPreview(dropPreview = null) {
    if (!dropPreview || typeof dropPreview !== 'object') {
      return null;
    }

    const itemId = dropPreview.itemId || null;
    const zone = dropPreview.zone
      ? normalizeLayoutZone(dropPreview.zone, null)
      : null;
    const position = ['before', 'after', 'inside'].includes(
      dropPreview.position
    )
      ? dropPreview.position
      : null;

    if (!itemId && !zone && !position) {
      return null;
    }

    return {
      itemId,
      zone,
      position
    };
  }

  function normalizeLayoutEditorSessionState(layoutEditor = {}) {
    if (isLayoutEditorParked()) {
      return createDefaultLayoutEditorSessionState();
    }

    return {
      ...DEFAULT_LAYOUT_EDITOR_SESSION_STATE,
      ...(layoutEditor || {}),
      enabled: Boolean(layoutEditor.enabled),
      selectedItemId: layoutEditor.selectedItemId || null,
      hoveredItemId: layoutEditor.hoveredItemId || null,
      dragItemId: layoutEditor.dragItemId || null,
      dropPreview: normalizeLayoutDropPreview(layoutEditor.dropPreview)
    };
  }

  function areLayoutItemsEqual(nextItems = [], previousItems = []) {
    if (nextItems.length !== previousItems.length) {
      return false;
    }

    return nextItems.every((item, index) => {
      const previousItem = previousItems[index];

      return (
        Boolean(previousItem) &&
        item.id === previousItem.id &&
        item.type === previousItem.type &&
        item.zone === previousItem.zone &&
        item.entityId === previousItem.entityId &&
        item.size === previousItem.size
      );
    });
  }

  function areLayoutStatesEqual(nextLayout, previousLayout) {
    return areLayoutItemsEqual(
      nextLayout?.items || [],
      previousLayout?.items || []
    );
  }

  function areLayoutDropPreviewsEqual(nextPreview, previousPreview) {
    if (!nextPreview && !previousPreview) {
      return true;
    }

    if (!nextPreview || !previousPreview) {
      return false;
    }

    return (
      nextPreview.itemId === previousPreview.itemId &&
      nextPreview.zone === previousPreview.zone &&
      nextPreview.position === previousPreview.position
    );
  }

  function areLayoutEditorStatesEqual(nextState, previousState) {
    return (
      Boolean(nextState) &&
      Boolean(previousState) &&
      nextState.enabled === previousState.enabled &&
      nextState.selectedItemId === previousState.selectedItemId &&
      nextState.hoveredItemId === previousState.hoveredItemId &&
      nextState.dragItemId === previousState.dragItemId &&
      areLayoutDropPreviewsEqual(
        nextState.dropPreview,
        previousState.dropPreview
      )
    );
  }

  function getCurrentLayoutEntitiesState() {
    const currentState = window.getAppState?.() || {};
    return getLayoutEntities({
      channels: currentState.channels,
      standaloneButtons: currentState.standaloneButtons
    });
  }

  function getLayoutState() {
    return normalizeLayoutState(
      window.getAppState?.().layout,
      getCurrentLayoutEntitiesState()
    );
  }

  function getLayoutItemsState() {
    return getLayoutState().items;
  }

  function getLayoutItemsByZoneState(zone) {
    const normalizedZone = normalizeLayoutZone(zone, null);

    if (!normalizedZone) {
      return [];
    }

    return getLayoutItemsState().filter((item) => item.zone === normalizedZone);
  }

  function findLayoutItemState(itemId) {
    return getLayoutItemsState().find((item) => item.id === itemId) || null;
  }

  function findLayoutEntityItemState(type, entityId) {
    const normalizedEntityId = parseLayoutEntityId(entityId);

    if (!isEntityLayoutItemType(type) || normalizedEntityId === null) {
      return null;
    }

    return (
      getLayoutItemsState().find(
        (item) => item.type === type && item.entityId === normalizedEntityId
      ) || null
    );
  }

  function getLayoutEditorSessionState() {
    return normalizeLayoutEditorSessionState(
      window.getAppState?.().layoutEditor
    );
  }

  function isLayoutEditModeEnabledState() {
    return getLayoutEditorSessionState().enabled;
  }

  function getSelectedLayoutItemIdState() {
    return getLayoutEditorSessionState().selectedItemId;
  }

  function getHoveredLayoutItemIdState() {
    return getLayoutEditorSessionState().hoveredItemId;
  }

  function getDraggedLayoutItemIdState() {
    return getLayoutEditorSessionState().dragItemId;
  }

  function getLayoutDropPreviewState() {
    return getLayoutEditorSessionState().dropPreview;
  }

  function updateLayoutState(updater, meta = {}) {
    let nextLayoutState = null;

    window.setAppState?.((previousState) => {
      const currentEntities = getLayoutEntities({
        channels: previousState.channels,
        standaloneButtons: previousState.standaloneButtons
      });
      const currentLayoutState = normalizeLayoutState(
        previousState.layout,
        currentEntities
      );
      const draftLayoutState =
        typeof updater === 'function'
          ? updater(currentLayoutState) || currentLayoutState
          : {
              ...currentLayoutState,
              ...(updater || {})
            };
      const normalizedLayoutState = normalizeLayoutState(
        draftLayoutState,
        currentEntities
      );

      nextLayoutState = normalizedLayoutState;

      if (areLayoutStatesEqual(normalizedLayoutState, currentLayoutState)) {
        return previousState;
      }

      return {
        ...previousState,
        layout: normalizedLayoutState
      };
    }, meta);

    return nextLayoutState;
  }

  function setLayoutState(layout, meta = {}) {
    return updateLayoutState(layout, {
      type: 'layout/set',
      source: 'layout-store',
      ...meta
    });
  }

  function setLayoutItemsState(items, meta = {}) {
    return updateLayoutState(
      (layoutState) => ({
        ...layoutState,
        items: Array.isArray(items) ? items : layoutState.items
      }),
      {
        type: 'layout/set-items',
        source: 'layout-store',
        ...meta
      }
    );
  }

  function resolveZoneInsertIndex(zoneItems, index) {
    if (index === null || index === undefined || Number.isNaN(Number(index))) {
      return zoneItems.length;
    }

    return Math.max(
      0,
      Math.min(zoneItems.length, Number.parseInt(index, 10) || 0)
    );
  }

  function insertLayoutItemAtZoneIndex(
    layoutItems,
    nextItem,
    index,
    options = {}
  ) {
    const itemsByZone = createLayoutItemsByZone();
    const removedItemId = options.removedItemId || null;

    layoutItems.forEach((item) => {
      if (removedItemId && item.id === removedItemId) {
        return;
      }

      itemsByZone[item.zone].push(item);
    });

    const nextZoneItems = itemsByZone[nextItem.zone].slice();
    nextZoneItems.splice(
      resolveZoneInsertIndex(nextZoneItems, index),
      0,
      nextItem
    );
    itemsByZone[nextItem.zone] = nextZoneItems;

    return combineLayoutItemsByZone(itemsByZone);
  }

  function ensureLayoutEntityItemState(type, entityId, meta = {}) {
    const defaultItem = createEntityLayoutItem(type, entityId);

    if (!defaultItem) {
      return null;
    }

    updateLayoutState(
      (layoutState) => {
        const hasItem = layoutState.items.some(
          (item) =>
            item.type === defaultItem.type &&
            item.entityId === defaultItem.entityId
        );

        if (hasItem) {
          return layoutState;
        }

        return {
          ...layoutState,
          items: [...layoutState.items, defaultItem]
        };
      },
      {
        type: 'layout/ensure-entity-item',
        source: 'layout-store',
        entityType: type,
        entityId: defaultItem.entityId,
        ...meta
      }
    );

    return findLayoutEntityItemState(type, entityId);
  }

  function moveLayoutItemState(itemId, targetIndex, options = {}, meta = {}) {
    let movedItem = null;

    updateLayoutState(
      (layoutState) => {
        const currentItem = layoutState.items.find(
          (item) => item.id === itemId
        );

        if (!currentItem) {
          return layoutState;
        }

        const nextZone =
          currentItem.type === LAYOUT_ITEM_TYPES.spacer
            ? normalizeLayoutZone(options.zone, currentItem.zone)
            : currentItem.zone;
        movedItem = {
          ...currentItem,
          zone: nextZone
        };

        return {
          ...layoutState,
          items: insertLayoutItemAtZoneIndex(
            layoutState.items,
            movedItem,
            targetIndex,
            { removedItemId: currentItem.id }
          )
        };
      },
      {
        type: 'layout/move-item',
        source: 'layout-store',
        itemId,
        targetIndex,
        ...meta
      }
    );

    return movedItem;
  }

  function insertLayoutSpacerState(options = {}, meta = {}) {
    const nextSpacer = createSpacerLayoutItem(options);

    updateLayoutState(
      (layoutState) => ({
        ...layoutState,
        items: insertLayoutItemAtZoneIndex(
          layoutState.items,
          nextSpacer,
          options.index
        )
      }),
      {
        type: 'layout/insert-spacer',
        source: 'layout-store',
        itemId: nextSpacer.id,
        ...meta
      }
    );

    return findLayoutItemState(nextSpacer.id);
  }

  function removeLayoutItemState(itemId, meta = {}) {
    let removedItem = null;

    updateLayoutState(
      (layoutState) => {
        removedItem =
          layoutState.items.find((item) => item.id === itemId) || null;

        if (!removedItem) {
          return layoutState;
        }

        return {
          ...layoutState,
          items: layoutState.items.filter((item) => item.id !== itemId)
        };
      },
      {
        type: 'layout/remove-item',
        source: 'layout-store',
        itemId,
        ...meta
      }
    );

    return removedItem;
  }

  function removeLayoutItemsForEntityState(type, entityId, meta = {}) {
    const normalizedEntityId = parseLayoutEntityId(entityId);
    let removedItems = [];

    if (!isEntityLayoutItemType(type) || normalizedEntityId === null) {
      return removedItems;
    }

    updateLayoutState(
      (layoutState) => {
        removedItems = layoutState.items.filter(
          (item) => item.type === type && item.entityId === normalizedEntityId
        );

        if (!removedItems.length) {
          return layoutState;
        }

        return {
          ...layoutState,
          items: layoutState.items.filter(
            (item) =>
              !(item.type === type && item.entityId === normalizedEntityId)
          )
        };
      },
      {
        type: 'layout/remove-entity-items',
        source: 'layout-store',
        entityType: type,
        entityId: normalizedEntityId,
        ...meta
      }
    );

    return removedItems;
  }

  function updateLayoutEditorSessionState(updater, meta = {}) {
    let nextLayoutEditorState = null;

    window.setAppState?.((previousState) => {
      const currentLayoutEditorState = normalizeLayoutEditorSessionState(
        previousState.layoutEditor
      );
      const draftLayoutEditorState =
        typeof updater === 'function'
          ? updater(currentLayoutEditorState) || currentLayoutEditorState
          : {
              ...currentLayoutEditorState,
              ...(updater || {})
            };
      const normalizedLayoutEditorState = normalizeLayoutEditorSessionState(
        draftLayoutEditorState
      );

      nextLayoutEditorState = normalizedLayoutEditorState;

      if (
        areLayoutEditorStatesEqual(
          normalizedLayoutEditorState,
          currentLayoutEditorState
        )
      ) {
        return previousState;
      }

      return {
        ...previousState,
        layoutEditor: normalizedLayoutEditorState
      };
    }, meta);

    return nextLayoutEditorState;
  }

  function setLayoutEditorSessionState(layoutEditorState, meta = {}) {
    return updateLayoutEditorSessionState(layoutEditorState, {
      type: 'layout-editor/set',
      source: 'layout-store',
      ...meta
    });
  }

  function patchLayoutEditorSessionState(patch, meta = {}) {
    return updateLayoutEditorSessionState(
      (layoutEditorState) => ({
        ...layoutEditorState,
        ...(patch || {})
      }),
      {
        type: 'layout-editor/patch',
        source: 'layout-store',
        ...meta
      }
    );
  }

  function setLayoutEditModeEnabledState(enabled, meta = {}) {
    return patchLayoutEditorSessionState(
      {
        enabled: Boolean(enabled)
      },
      {
        type: 'layout-editor/set-enabled',
        ...meta
      }
    );
  }

  function setSelectedLayoutItemIdState(itemId, meta = {}) {
    return patchLayoutEditorSessionState(
      {
        selectedItemId: itemId || null
      },
      {
        type: 'layout-editor/set-selection',
        ...meta
      }
    );
  }

  function setHoveredLayoutItemIdState(itemId, meta = {}) {
    return patchLayoutEditorSessionState(
      {
        hoveredItemId: itemId || null
      },
      {
        type: 'layout-editor/set-hover',
        ...meta
      }
    );
  }

  function setDraggedLayoutItemIdState(itemId, meta = {}) {
    return patchLayoutEditorSessionState(
      {
        dragItemId: itemId || null
      },
      {
        type: 'layout-editor/set-drag-item',
        ...meta
      }
    );
  }

  function setLayoutDropPreviewState(dropPreview, meta = {}) {
    return patchLayoutEditorSessionState(
      {
        dropPreview: normalizeLayoutDropPreview(dropPreview)
      },
      {
        type: 'layout-editor/set-drop-preview',
        ...meta
      }
    );
  }

  function clearLayoutDropPreviewState(meta = {}) {
    return patchLayoutEditorSessionState(
      {
        dropPreview: null
      },
      {
        type: 'layout-editor/clear-drop-preview',
        ...meta
      }
    );
  }

  function subscribeLayoutState(listener) {
    if (
      typeof listener !== 'function' ||
      typeof window.subscribeAppState !== 'function'
    ) {
      return () => {};
    }

    return window.subscribeAppState((nextState, previousState, meta = {}) => {
      const nextLayoutState = normalizeLayoutState(nextState.layout, {
        channels: nextState.channels,
        standaloneButtons: nextState.standaloneButtons
      });
      const previousLayoutState = normalizeLayoutState(previousState.layout, {
        channels: previousState.channels,
        standaloneButtons: previousState.standaloneButtons
      });

      if (areLayoutStatesEqual(nextLayoutState, previousLayoutState)) {
        return;
      }

      listener(nextLayoutState, previousLayoutState, meta);
    });
  }

  function subscribeLayoutEditorSessionState(listener) {
    if (
      typeof listener !== 'function' ||
      typeof window.subscribeAppState !== 'function'
    ) {
      return () => {};
    }

    return window.subscribeAppState((nextState, previousState, meta = {}) => {
      const nextLayoutEditorState = normalizeLayoutEditorSessionState(
        nextState.layoutEditor
      );
      const previousLayoutEditorState = normalizeLayoutEditorSessionState(
        previousState.layoutEditor
      );

      if (
        areLayoutEditorStatesEqual(
          nextLayoutEditorState,
          previousLayoutEditorState
        )
      ) {
        return;
      }

      listener(nextLayoutEditorState, previousLayoutEditorState, meta);
    });
  }

  window.LAYOUT_ZONES = LAYOUT_ZONES;
  window.LAYOUT_ITEM_TYPES = LAYOUT_ITEM_TYPES;
  window.createEmptyLayoutState = createEmptyLayoutState;
  window.createDefaultLayoutEditorSessionState =
    createDefaultLayoutEditorSessionState;
  window.createEntityLayoutItem = createEntityLayoutItem;
  window.createSpacerLayoutItem = createSpacerLayoutItem;
  window.normalizeLayoutItem = normalizeLayoutItem;
  window.normalizeLayoutState = normalizeLayoutState;
  window.normalizeLayoutEditorSessionState = normalizeLayoutEditorSessionState;
  window.isLayoutEditorParked = isLayoutEditorParked;
  window.getLayoutState = getLayoutState;
  window.getLayoutItemsState = getLayoutItemsState;
  window.getLayoutItemsByZoneState = getLayoutItemsByZoneState;
  window.findLayoutItemState = findLayoutItemState;
  window.findLayoutEntityItemState = findLayoutEntityItemState;
  window.getLayoutEditorSessionState = getLayoutEditorSessionState;
  window.isLayoutEditModeEnabledState = isLayoutEditModeEnabledState;
  window.getSelectedLayoutItemIdState = getSelectedLayoutItemIdState;
  window.getHoveredLayoutItemIdState = getHoveredLayoutItemIdState;
  window.getDraggedLayoutItemIdState = getDraggedLayoutItemIdState;
  window.getLayoutDropPreviewState = getLayoutDropPreviewState;
  window.subscribeLayoutState = subscribeLayoutState;
  window.subscribeLayoutEditorSessionState = subscribeLayoutEditorSessionState;
  window.setLayoutState = setLayoutState;
  window.setLayoutItemsState = setLayoutItemsState;
  window.ensureLayoutEntityItemState = ensureLayoutEntityItemState;
  window.moveLayoutItemState = moveLayoutItemState;
  window.insertLayoutSpacerState = insertLayoutSpacerState;
  window.removeLayoutItemState = removeLayoutItemState;
  window.removeLayoutItemsForEntityState = removeLayoutItemsForEntityState;
  window.setLayoutEditorSessionState = setLayoutEditorSessionState;
  window.patchLayoutEditorSessionState = patchLayoutEditorSessionState;
  window.setLayoutEditModeEnabledState = setLayoutEditModeEnabledState;
  window.setSelectedLayoutItemIdState = setSelectedLayoutItemIdState;
  window.setHoveredLayoutItemIdState = setHoveredLayoutItemIdState;
  window.setDraggedLayoutItemIdState = setDraggedLayoutItemIdState;
  window.setLayoutDropPreviewState = setLayoutDropPreviewState;
  window.clearLayoutDropPreviewState = clearLayoutDropPreviewState;
})(window);
