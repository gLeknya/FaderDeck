(function initAppScrollbars(window) {
  const DEFAULT_HIDE_DELAY_MS = 1600;
  const DEFAULT_MIN_THUMB_SIZE = 34;

  function noop() {}

  function resolveElement(target) {
    if (typeof target === 'function') {
      return target() || null;
    }

    return target || null;
  }

  function createAppScrollbar(options = {}) {
    const orientation = options.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const hideDelay = Number.isFinite(options.hideDelay)
      ? Math.max(0, options.hideDelay)
      : DEFAULT_HIDE_DELAY_MS;
    const alwaysVisible = Boolean(options.alwaysVisible);
    const minThumbSize = Number.isFinite(options.minThumbSize)
      ? Math.max(18, options.minThumbSize)
      : DEFAULT_MIN_THUMB_SIZE;
    const getEnabled = typeof options.getEnabled === 'function'
      ? options.getEnabled
      : () => true;
    const onSync = typeof options.onSync === 'function'
      ? options.onSync
      : noop;
    const onScroll = typeof options.onScroll === 'function'
      ? options.onScroll
      : noop;
    const onWheel = typeof options.onWheel === 'function'
      ? options.onWheel
      : noop;

    const state = {
      rafId: null,
      hideTimerId: null,
      activePointerId: null,
      isDestroyed: false,
      scroller: null,
      track: null,
      resizeObserver: null,
      mutationObserver: null
    };

    const listeners = {
      scroll(event) {
        onScroll(event);
        controller.showForActivity();
        controller.scheduleSync();
      },
      wheel(event) {
        onWheel(event);
        controller.showForActivity();
      },
      pointerDown(event) {
        const track = resolveElement(options.getTrack || options.track);
        const scrollbar = resolveElement(options.getScrollbar || options.scrollbar);

        if (!track || !scrollbar || scrollbar.classList.contains('hidden')) {
          return;
        }

        if (event.target !== track && !track.contains(event.target)) {
          return;
        }

        event.preventDefault();
        state.activePointerId = event.pointerId;

        const thumb = resolveElement(options.getThumb || options.thumb);
        thumb?.classList.add('is-dragging');
        applyPointerPosition(event);
        controller.showForActivity();
        controller.scheduleSync();

        window.addEventListener('pointermove', listeners.pointerMove);
        window.addEventListener('pointerup', listeners.pointerUp);
        window.addEventListener('pointercancel', listeners.pointerUp);
      },
      pointerMove(event) {
        if (state.activePointerId == null) {
          return;
        }

        applyPointerPosition(event);
        controller.showForActivity();
        controller.scheduleSync();
      },
      pointerUp() {
        if (state.activePointerId == null) {
          return;
        }

        state.activePointerId = null;
        resolveElement(options.getThumb || options.thumb)?.classList.remove('is-dragging');
        window.removeEventListener('pointermove', listeners.pointerMove);
        window.removeEventListener('pointerup', listeners.pointerUp);
        window.removeEventListener('pointercancel', listeners.pointerUp);
      },
      resize() {
        controller.scheduleSync();
      }
    };

    function getElements() {
      return {
        scroller: resolveElement(options.getScroller || options.scroller),
        scrollbar: resolveElement(options.getScrollbar || options.scrollbar),
        track: resolveElement(options.getTrack || options.track),
        thumb: resolveElement(options.getThumb || options.thumb)
      };
    }

    function unbindScroller() {
      if (!state.scroller) {
        return;
      }

      disconnectMutationObserver();
      state.scroller.removeEventListener('scroll', listeners.scroll);
      state.scroller.removeEventListener('wheel', listeners.wheel);
      state.scroller = null;
    }

    function unbindTrack() {
      if (!state.track) {
        return;
      }

      state.track.removeEventListener('pointerdown', listeners.pointerDown);
      state.track = null;
    }

    function disconnectResizeObserver() {
      state.resizeObserver?.disconnect();
    }

    function disconnectMutationObserver() {
      state.mutationObserver?.disconnect();
    }

    function connectResizeObserver() {
      if (typeof window.ResizeObserver !== 'function') {
        return;
      }

      disconnectResizeObserver();
      state.resizeObserver = new window.ResizeObserver(() => {
        controller.scheduleSync();
      });

      if (state.scroller) {
        state.resizeObserver.observe(state.scroller);
      }

      if (state.track) {
        state.resizeObserver.observe(state.track);
      }
    }

    function connectMutationObserver() {
      if (typeof window.MutationObserver !== 'function' || !state.scroller) {
        return;
      }

      disconnectMutationObserver();
      state.mutationObserver = new window.MutationObserver(() => {
        controller.scheduleSync();
      });

      state.mutationObserver.observe(state.scroller, {
        childList: true,
        subtree: true,
        attributes: true
      });
    }

    function bindElements() {
      const { scroller, track } = getElements();
      const scrollerChanged = scroller !== state.scroller;
      const trackChanged = track !== state.track;

      if (!scrollerChanged && !trackChanged) {
        return;
      }

      if (scrollerChanged) {
        unbindScroller();

        if (scroller) {
          scroller.addEventListener('scroll', listeners.scroll, { passive: true });
          scroller.addEventListener('wheel', listeners.wheel, { passive: true });
          state.scroller = scroller;
        }
      }

      if (trackChanged) {
        unbindTrack();

        if (track) {
          track.addEventListener('pointerdown', listeners.pointerDown);
          state.track = track;
        }
      }

      connectResizeObserver();
      connectMutationObserver();
    }

    function getMetricState() {
      bindElements();
      const { scroller, scrollbar, track, thumb } = getElements();

      if (!scroller || !scrollbar || !track || !thumb) {
        return null;
      }

      const enabled = Boolean(getEnabled());
      const clientSize = orientation === 'horizontal'
        ? scroller.clientWidth
        : scroller.clientHeight;
      const scrollSize = orientation === 'horizontal'
        ? scroller.scrollWidth
        : scroller.scrollHeight;
      const position = orientation === 'horizontal'
        ? scroller.scrollLeft
        : scroller.scrollTop;
      const maxScroll = Math.max(0, scrollSize - clientSize);
      const shouldShow = enabled && maxScroll > 0;
      const trackSize = orientation === 'horizontal'
        ? track.clientWidth
        : track.clientHeight;
      const visibleRatio = clientSize / Math.max(scrollSize, 1);
      const thumbSize = Math.max(minThumbSize, Math.round(trackSize * visibleRatio));
      const thumbTravel = Math.max(0, trackSize - thumbSize);
      const progress = maxScroll > 0 ? Math.max(0, Math.min(1, position / maxScroll)) : 0;
      const thumbOffset = thumbTravel * progress;

      return {
        enabled,
        shouldShow,
        clientSize,
        scrollSize,
        position,
        maxScroll,
        trackSize,
        thumbSize,
        thumbTravel,
        thumbOffset,
        scroller,
        scrollbar,
        track,
        thumb
      };
    }

    function applyPointerPosition(event) {
      const metrics = getMetricState();

      if (!metrics?.shouldShow) {
        return;
      }

      const rect = metrics.track.getBoundingClientRect();
      const pointerOffset = orientation === 'horizontal'
        ? event.clientX - rect.left
        : event.clientY - rect.top;
      const centeredOffset = pointerOffset - (metrics.thumbSize / 2);
      const normalizedOffset = Math.max(0, Math.min(metrics.thumbTravel, centeredOffset));
      const nextPosition = metrics.thumbTravel > 0
        ? (normalizedOffset / metrics.thumbTravel) * metrics.maxScroll
        : 0;

      if (orientation === 'horizontal') {
        metrics.scroller.scrollLeft = nextPosition;
        return;
      }

      metrics.scroller.scrollTop = nextPosition;
    }

    const controller = {
      sync() {
        if (state.isDestroyed) {
          return null;
        }

        const metrics = getMetricState();

        if (!metrics) {
          return null;
        }

        metrics.scrollbar.classList.toggle('hidden', !metrics.shouldShow);

        if (!metrics.shouldShow) {
          controller.clearActivity();
          metrics.thumb.style.removeProperty('width');
          metrics.thumb.style.removeProperty('height');
          metrics.thumb.style.removeProperty('transform');
          onSync(metrics);
          return metrics;
        }

        if (alwaysVisible) {
          metrics.scrollbar.classList.add('is-active');
        }

        if (orientation === 'horizontal') {
          metrics.thumb.style.width = `${metrics.thumbSize}px`;
          metrics.thumb.style.height = '';
          metrics.thumb.style.transform = `translate(${metrics.thumbOffset}px, -50%)`;
        } else {
          metrics.thumb.style.height = `${metrics.thumbSize}px`;
          metrics.thumb.style.width = '';
          metrics.thumb.style.transform = `translate(-50%, ${metrics.thumbOffset}px)`;
        }

        onSync(metrics);
        return metrics;
      },
      scheduleSync() {
        if (state.isDestroyed) {
          return;
        }

        bindElements();

        if (state.rafId) {
          cancelAnimationFrame(state.rafId);
        }

        state.rafId = requestAnimationFrame(() => {
          state.rafId = null;
          controller.sync();
        });
      },
      cancelSync() {
        if (!state.rafId) {
          return;
        }

        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      },
      showForActivity() {
        if (state.isDestroyed) {
          return;
        }

        bindElements();
        const metrics = controller.sync();
        const scrollbar = metrics?.scrollbar || resolveElement(options.getScrollbar || options.scrollbar);

        if (!metrics?.shouldShow || !scrollbar || scrollbar.classList.contains('hidden')) {
          return;
        }

        if (alwaysVisible) {
          scrollbar.classList.add('is-active');
          return;
        }

        scrollbar.classList.add('is-active');
        controller.clearActivity({ preserveClass: true });
        state.hideTimerId = window.setTimeout(() => {
          state.hideTimerId = null;
          resolveElement(options.getScrollbar || options.scrollbar)?.classList.remove('is-active');
        }, hideDelay);
      },
      clearActivity({ preserveClass = false } = {}) {
        if (state.hideTimerId) {
          clearTimeout(state.hideTimerId);
          state.hideTimerId = null;
        }

        if (!preserveClass) {
          resolveElement(options.getScrollbar || options.scrollbar)?.classList.remove('is-active');
        }
      },
      destroy() {
        if (state.isDestroyed) {
          return;
        }

        state.isDestroyed = true;
        controller.cancelSync();
        controller.clearActivity();
        listeners.pointerUp();
        unbindScroller();
        unbindTrack();
        disconnectResizeObserver();
        disconnectMutationObserver();
        window.removeEventListener('resize', listeners.resize);
      }
    };

    window.addEventListener('resize', listeners.resize);
    controller.scheduleSync();

    return controller;
  }

  window.createAppScrollbar = createAppScrollbar;
})(window);
