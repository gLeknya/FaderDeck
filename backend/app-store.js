const DEFAULT_MAIN_WINDOW_STATE = Object.freeze({
  width: 1400,
  height: 800,
  x: null,
  y: null,
  isMaximized: false
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
    width: normalizeDimension(state.width, DEFAULT_MAIN_WINDOW_STATE.width, 980),
    height: normalizeDimension(state.height, DEFAULT_MAIN_WINDOW_STATE.height, 640),
    x: normalizeCoordinate(state.x),
    y: normalizeCoordinate(state.y),
    isMaximized: state.isMaximized === true
  };
}

async function getStoreInstance() {
  if (!storePromise) {
    storePromise = import('electron-store')
      .then(({ default: Store }) => new Store({
        name: 'app-state',
        defaults: {
          mainWindow: DEFAULT_MAIN_WINDOW_STATE
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
          }
        }
      }))
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

module.exports = {
  DEFAULT_MAIN_WINDOW_STATE,
  getMainWindowState,
  saveMainWindowState
};
