# fader-scroll

Lightweight custom scrollbar library. Native scroll + custom track & thumb. Zero dependencies, pure ESM.

## Quick Start

1. **Import CSS** (`<link>` or `import`):
   ```html
   <link rel="stylesheet" href="path/to/fader-scroll.css">
   ```
   ```js
   import 'fader-scroll/styles/fader-scroll.css'; // if using a bundler
   ```

2. **Import JS**:
   ```js
   import { createScroll } from 'fader-scroll';
   ```

3. **Basic usage**:
   ```js
   const el = document.querySelector('.my-scrollable-element');
   createScroll(el, { axis: 'y' });
   ```

4. **Declarative**:
   ```html
   <div data-scroll="y" class="my-scrollable-element">
     Content...
   </div>
   ```
   ```js
   import { initScrolls } from 'fader-scroll';
   initScrolls(); // Initializes all [data-scroll] elements
   ```

## Installation

Copy the `src` and `styles` folders into your project, or `npm install fader-scroll` (when published).

## API

### `createScroll(el, opts?)`
Initializes a scrollbar on the element `el`. Returns an instance. If already initialized on the given element, returns the existing instance and updates options.

### `initScrolls(root?)`
Finds all elements with the `[data-scroll]` attribute within `root` (defaults to `document`) and initializes them. Idempotent.

### `setDefaults(opts)`
Set global default options for all future instances.

### `definePreset(name, { options?, className? })`
Register a reusable preset that combines options and a custom CSS class.

### `getInstance(el)`
Get the existing scroll instance on the element `el`, or `null` if none exists.

### Instance methods
- `update()` - Force re-measure sizes and positions. Useful if the content size changes without triggering `ResizeObserver`.
- `setOptions(opts)` - Change options at runtime.
- `on(event, fn)` / `off(event, fn)` - Event emitter. Events: `scroll`, `show`, `hide`, `update`, `dragstart`, `dragend`, `overflowchange`.
- `getState()` - Read-only state object, e.g., `{ y?: { offset, size, presence, scrollable, maxScroll }, x?: ... }`.
- `destroy()` - Full cleanup, removes event listeners, observers, custom track elements, and restores the original DOM.

### Declarative API
You can set options via `data-scroll-*` attributes in kebab-case:
`data-scroll="y|x|both"`, `data-scroll-visibility="always"`, `data-scroll-preset="thin"`, `data-scroll-horizontal-wheel="auto"`, etc.

## JS Options

Options configure the behavior of the scrollbars.

| Option | Values | Default |
|--------|--------|---------|
| `axis` | `'y' \| 'x' \| 'both'` | `'y'` |
| `mount` | Element, selector, or `{ x, y }` | `null` (track inside host) |
| `visibility` | `'auto' \| 'always' \| 'hover' \| 'never'` | `'auto'` |
| `triggers` | `{ scroll, hoverHost, hoverTrack, drag, resize }` (booleans) | all `true` |
| `idleDelay` | milliseconds | `900` |
| `fadeIn` / `fadeOut` | milliseconds | `120` / `350` |
| `easing` | string (e.g. `'ease-out'`) or function `t => t` | `'ease-out'` |
| `hideWhenNoOverflow`| boolean | `true` |
| `smoothing` | number (ms, `tau`) or `{ offset, size }` | `{ offset: 80, size: 140 }` (0 = off) |
| `minThumb` | px (number) | `24` |
| `horizontalWheel` | `'shift' \| 'always' \| 'auto'` | `'shift'` |
| `trackClick` | `'page' \| 'jump' \| 'none'` | `'page'` |
| `animation` | `'fade' \| 'slide' \| 'scale' \| 'none'` (adds `sb-anim-*` class) | `'fade'` |
| `reducedMotion` | `'respect' \| 'ignore'` | `'respect'` |
| `preset` | string (preset name) | `null` |
| `className` | string (theme class on host) | `''` |

### Option Priority
`built-in defaults` < `setDefaults()` < `preset` < `data-scroll-*` attributes < explicit `opts` in `createScroll`.

## CSS Variables

Variables can be defined on the host, on any ancestor, in a theme, or in a preset (`className`). For `mount`, variables are read from the element where the track is mounted.

### Input Variables (set by user)

| Variable | Default | Description |
|----------|---------|-------------|
| `--sb-thickness` | `6px` | Track and thumb thickness |
| `--sb-thickness-active`| `10px` | Thickness when hovering track or dragging |
| `--sb-thickness-transition`| `120ms` | Speed of thickness change |
| `--sb-track-bg` | `transparent` | Track background |
| `--sb-track-radius` | `999px` | Track border-radius |
| `--sb-thumb-bg` | `rgb(128 128 128 / .55)`| Thumb background (colors or gradients) |
| `--sb-thumb-bg-hover` | `rgb(128 128 128 / .75)`| Thumb background on hover |
| `--sb-thumb-bg-active` | `rgb(128 128 128 / .9)` | Thumb background when dragging |
| `--sb-thumb-radius` | `999px` | Thumb border-radius |
| `--sb-thumb-border` | `none` | Thumb border |
| `--sb-thumb-shadow` | `none` | Thumb box-shadow |
| `--sb-y-top` | `4px` | Vertical track top offset |
| `--sb-y-bottom` | `4px` | Vertical track bottom offset |
| `--sb-y-right` | `2px` | Vertical track right offset |
| `--sb-y-left` | `auto` | Vertical track left offset |
| `--sb-x-left` | `4px` | Horizontal track left offset |
| `--sb-x-right` | `4px` | Horizontal track right offset |
| `--sb-x-bottom` | `2px` | Horizontal track bottom offset |
| `--sb-x-top` | `auto` | Horizontal track top offset |
| `--sb-corner-gap` | `calc(var(--sb-thickness-active) + 4px)` | Gap at the corner for both axes (`sb-has-both`) |
| `--sb-z` | `10` | Track z-index |

### Output Variables (written by library)
The library writes these variables to the track element (read-only):
- `--sb-thumb-offset` (px)
- `--sb-thumb-size` (px)
- `--sb-presence` (0..1)

## CSS Classes

- **Host**: `sb-host`, `sb-has-x`, `sb-has-y`, `sb-has-both`, `sb-scrollable-x`, `sb-scrollable-y`, `sb-active` (recent activity), `sb-hover`, `sb-dragging`, `sb-anim-<name>`, theme class.
- **Track**: `sb-track`, `sb-x`, `sb-y`, `sb-visible` (`presence > 0`), `sb-hidden` (`presence == 0`), `sb-hover`, `sb-dragging`.
- **Thumb**: `sb-thumb`.

## Examples

### Horizontal scroll with wheel conversion
Converts vertical mouse wheel scroll to horizontal scrolling.
```js
createScroll(el, { axis: 'x', horizontalWheel: 'always' });
```

### Both axes
```js
createScroll(el, { axis: 'both' });
```

### Always visible, thin preset
```js
definePreset('thin', {
  options: { minThumb: 16, visibility: 'always' },
  className: 'sb-theme-thin'
});
createScroll(el, { preset: 'thin' });
```

### Custom gradient thumb
```css
.gradient-scroll {
  --sb-thumb-bg: linear-gradient(135deg, #667eea, #764ba2);
  --sb-thumb-bg-hover: linear-gradient(135deg, #764ba2, #667eea);
}
```

### External mount
Mounts the vertical track inside a separate container element.
```js
createScroll(el, { axis: 'y', mount: '#my-rail' });
```

### Prefers-reduced-motion
The library defaults to `reducedMotion: 'respect'`, which instantly reduces smoothing and fade timings to 0ms if the user has requested reduced motion in their OS settings.

## ⚠️ Important Notes

- **`horizontalWheel: 'always'`** on an element with `axis: 'both'` captures ALL vertical wheel events for horizontal scrolling. Use `'auto'` for such elements to only scroll horizontally if there is no vertical overflow.
- **Auto-host wrapping** may break flex/grid layouts. Pre-create the host manually with the class `sb-host` in such cases.
- **Page-level scrolling** (`html` / `body`) is not supported in v1.
- **CSS must be imported separately**; the JS does not inject styles automatically.

## DOM Structure

If the element `el` does not have a parent with class `sb-host`, it will be wrapped automatically:

```html
<div class="sb-host sb-has-y">                  <!-- host: created by library or pre-existing -->
  <div class="sb-viewport your-own-classes">    <!-- el: scrolls natively -->
    ...content...
  </div>
  <div class="sb-track sb-y" aria-hidden="true">
    <div class="sb-thumb"></div>
  </div>
  <!-- when axis: 'x' | 'both', .sb-track.sb-x is also added -->
</div>
```

## Limitations

- No `smoothWheel` (smooth content scrolling) in v1
- No RTL support
- No page-level scroll
- No track press-and-hold repeat
- No gutter (space reservation)

## Browser Support

Modern Chromium, Firefox, Safari (WebKit). Requires ES modules.

## License

MIT
