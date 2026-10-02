// FaderDeck switch — vanilla JS
// const sw = createSwitch({ checked: true, label: 'Автозапуск', onChange: v => ... });
// parent.append(sw);  sw.get() / sw.set(true)
export function createSwitch({ checked = false, disabled = false, size = '', label = '', onChange } = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'fd-switch' + (size ? ` fd-switch--${size}` : '');
  wrap.innerHTML =
    '<input type="checkbox" role="switch">' +
    '<span class="fd-switch__track"><span class="fd-switch__knob"></span></span>';
  const input = wrap.querySelector('input');
  input.checked = checked;
  input.disabled = disabled;
  if (label) input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange?.(input.checked));
  wrap.get = () => input.checked;
  wrap.set = (v) => { input.checked = !!v; };
  return wrap;
}
