(function initRendererStore(window) {
  function createRendererStore(initialState = {}) {
    let state = initialState;
    const listeners = new Set();

    function getState() {
      return state;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function setState(nextStateOrUpdater, meta = {}) {
      const previousState = state;
      const nextState =
        typeof nextStateOrUpdater === 'function'
          ? nextStateOrUpdater(previousState)
          : nextStateOrUpdater;

      if (!nextState || nextState === previousState) {
        return previousState;
      }

      state = nextState;
      listeners.forEach((listener) => {
        listener(state, previousState, meta);
      });
      return state;
    }

    return {
      getState,
      subscribe,
      setState
    };
  }

  window.createRendererStore = createRendererStore;
})(window);
