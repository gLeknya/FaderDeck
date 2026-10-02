/**
 * Convert kebab-case to camelCase.
 * 'idle-delay' → 'idleDelay'
 */
function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Parse a string value to the appropriate type.
 * - 'true'/'false' → boolean
 * - numeric strings → number
 * - JSON (starts with { or [) → parsed object
 * - otherwise → string as-is
 */
function parseValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === '') return true; // bare attribute
  // Try number
  const num = Number(str);
  if (!isNaN(num) && str.trim() !== '') return num;
  // Try JSON
  if (typeof str === 'string' && (str.startsWith('{') || str.startsWith('['))) {
    try { return JSON.parse(str); } catch { /* fall through */ }
  }
  return str;
}

/**
 * Parse a dataset-like object into fader-scroll options.
 * Input keys are like: scroll, scrollVisibility, scrollIdleDelay, scrollMountX, etc.
 * (HTML data-scroll-idle-delay → dataset.scrollIdleDelay)
 * @param {object} dataset - plain object with camelCase keys (like element.dataset)
 * @returns {object} options object
 */
export function parseAttrs(dataset) {
  const opts = {};
  
  // data-scroll → axis
  if (dataset.scroll !== undefined) {
    const val = dataset.scroll;
    if (val === '' || val === 'true' || val === true) {
      opts.axis = 'y'; // default when just data-scroll is present
    } else {
      opts.axis = val;
    }
  }
  
  // Process all data-scroll-* attributes
  for (const [key, rawValue] of Object.entries(dataset)) {
    if (!key.startsWith('scroll') || key === 'scroll') continue;
    
    // Remove 'scroll' prefix and lowercase first char
    const optName = key.slice(6); // remove 'scroll'
    const camelName = optName.charAt(0).toLowerCase() + optName.slice(1);
    
    const value = parseValue(rawValue);
    
    // Handle mount variants
    if (camelName === 'mountX') {
      if (!opts.mount || typeof opts.mount === 'string') {
        opts.mount = { x: value, y: opts.mount?.y || undefined };
      } else {
        opts.mount.x = value;
      }
      continue;
    }
    if (camelName === 'mountY') {
      if (!opts.mount || typeof opts.mount === 'string') {
        opts.mount = { x: opts.mount?.x || undefined, y: value };
      } else {
        opts.mount.y = value;
      }
      continue;
    }
    if (camelName === 'mount') {
      opts.mount = value;
      continue;
    }
    
    opts[camelName] = value;
  }
  
  return opts;
}
