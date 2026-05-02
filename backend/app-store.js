const DEFAULT_MAIN_WINDOW_STATE = Object.freeze({
  width: 1400,
  height: 800,
  x: null,
  y: null,
  isMaximized: false
});
const DEFAULT_APP_META = Object.freeze({
  lastSeenVersion: '',
  lastUpdatedAt: null
});

let storePromise = null;

function normalizeCoordinate(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function normalizeDimension(value, fallback, minValue) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < minValue) {
    return fallback;
  }

  return Math.round(numericValue);
}

function normalizeMainWindowState(state = {}) {
  return {
    width: normalizeDimension(
      state.width,
      DEFAULT_MAIN_WINDOW_STATE.width,
      980
    ),
    height: normalizeDimension(
      state.height,
      DEFAULT_MAIN_WINDOW_STATE.height,
      640
    ),
    x: normalizeCoordinate(state.x),
    y: normalizeCoordinate(state.y),
    isMaximized: state.isMaximized === true
  };
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedTimestamp = Date.parse(normalizedValue);

  if (Number.isNaN(parsedTimestamp)) {
    return null;
  }

  return new Date(parsedTimestamp).toISOString();
}

function normalizeAppMeta(meta = {}) {
  return {
    lastSeenVersion:
      typeof meta.lastSeenVersion === 'string'
        ? meta.lastSeenVersion.trim()
        : '',
    lastUpdatedAt: normalizeTimestamp(meta.lastUpdatedAt)
  };
}

async function getStoreInstance() {
  if (!storePromise) {
    storePromise = import('electron-store')
      .then(
        ({ default: Store }) =>
          new Store({
            name: 'app-state',
            defaults: {
              mainWindow: DEFAULT_MAIN_WINDOW_STATE,
              appMeta: DEFAULT_APP_META
            },
            schema: {
              mainWindow: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  width: {
                    type: 'number',
                    minimum: 980
                  },
                  height: {
                    type: 'number',
                    minimum: 640
                  },
                  x: {
                    type: ['number', 'null']
                  },
                  y: {
                    type: ['number', 'null']
                  },
                  isMaximized: {
                    type: 'boolean'
                  }
                }
              },
              appMeta: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  lastSeenVersion: {
                    type: 'string'
                  },
                  lastUpdatedAt: {
                    type: ['string', 'null']
                  }
                }
              }
            }
          })
      )
      .catch((error) => {
        storePromise = null;
        throw error;
      });
  }

  return storePromise;
}

async function getMainWindowState() {
  const store = await getStoreInstance();
  return normalizeMainWindowState(store.get('mainWindow'));
}

async function saveMainWindowState(window) {
  if (!window || window.isDestroyed()) {
    return DEFAULT_MAIN_WINDOW_STATE;
  }

  const store = await getStoreInstance();
  const bounds = window.getBounds();
  const windowState = normalizeMainWindowState({
    ...bounds,
    isMaximized: window.isMaximized()
  });

  store.set('mainWindow', windowState);

  return windowState;
}

async function getAppMeta() {
  const store = await getStoreInstance();
  return normalizeAppMeta(store.get('appMeta'));
}

async function touchAppVersion(version, updatedAt = new Date().toISOString()) {
  const normalizedVersion = typeof version === 'string' ? version.trim() : '';

  if (!normalizedVersion) {
    return DEFAULT_APP_META;
  }

  const store = await getStoreInstance();
  const currentMeta = normalizeAppMeta(store.get('appMeta'));
  const normalizedUpdatedAt =
    normalizeTimestamp(updatedAt) || new Date().toISOString();
  const shouldRefreshTimestamp =
    currentMeta.lastSeenVersion !== normalizedVersion ||
    !currentMeta.lastUpdatedAt;
  const nextMeta = normalizeAppMeta({
    lastSeenVersion: normalizedVersion,
    lastUpdatedAt: shouldRefreshTimestamp
      ? normalizedUpdatedAt
      : currentMeta.lastUpdatedAt
  });

  store.set('appMeta', nextMeta);

  return nextMeta;
}

module.exports = {
  DEFAULT_APP_META,
  DEFAULT_MAIN_WINDOW_STATE,
  getAppMeta,
  getMainWindowState,
  saveMainWindowState,
  touchAppVersion
};
