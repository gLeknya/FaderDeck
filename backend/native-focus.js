const path = require('path');
const { USE_NATIVE_FOCUS } = require('./feature-flags');

let nativeFocus = null;

try {
  // Try multiple paths for dev vs production
  let nativeModule;
  
  try {
    // Development: faderdeck-native/ directory
    nativeModule = require(path.join(__dirname, '../faderdeck-native'));
  } catch (devError) {
    // Production: Check if running from asar
    const { app } = require('electron');
    const isPackaged = app && app.isPackaged;
    
    if (isPackaged) {
      // In production, native modules are unpacked
      const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'faderdeck-native');
      nativeModule = require(unpackedPath);
    } else {
      throw devError;
    }
  }
  
  nativeFocus = nativeModule;
  console.log('[native:focus] Native module loaded successfully');
} catch (error) {
  console.warn('[native:focus] Native module not available:', error.message);
  console.warn('[native:focus] Will use PowerShell fallback');
}

/**
 * Get the currently focused window/application
 * @returns {Promise<{success: boolean, application?: object, error?: string}>}
 */
async function getFocusedWindow() {
  if (!USE_NATIVE_FOCUS || !nativeFocus) {
    return null; // Fallback to PowerShell in ProcessCatalog
  }

  const start = Date.now();

  try {
    const result = nativeFocus.getFocusedWindow();
    const latency = Date.now() - start;

    if (process.env.NODE_ENV === 'development') {
      console.log(`[native:focus] Success in ${latency}ms`);
    }

    if (!result) {
      return {
        success: false,
        error: 'no-foreground-window',
      };
    }

    // Transform to match PowerShell output format
    return {
      success: true,
      application: {
        pid: result.pid,
        process: result.process,
        processName: result.processName,
        path: result.path,
        mainWindowTitle: result.mainWindowTitle,
        name: humanizeProcessName(result.process),
        hasWindow: result.hasWindow,
      },
    };
  } catch (error) {
    const latency = Date.now() - start;
    console.error(`[native:focus] Failed after ${latency}ms:`, error);
    console.log('[native:focus] Activating PowerShell fallback');
    return null; // Fallback to PowerShell
  }
}

/**
 * Focus a window by process ID
 * @param {number} pid - Process ID
 * @returns {Promise<boolean>}
 */
async function focusWindowByPid(pid) {
  if (!USE_NATIVE_FOCUS || !nativeFocus) {
    throw new Error('Native focus module not available');
  }

  const start = Date.now();

  try {
    const result = nativeFocus.focusWindowByPid(pid);
    const latency = Date.now() - start;

    if (process.env.NODE_ENV === 'development') {
      console.log(`[native:focus] focusWindowByPid(${pid}) in ${latency}ms: ${result}`);
    }

    return result;
  } catch (error) {
    const latency = Date.now() - start;
    console.error(`[native:focus] focusWindowByPid failed after ${latency}ms:`, error);
    throw error;
  }
}

function humanizeProcessName(processFile) {
  const baseName = String(processFile || '')
    .replace(/\.exe$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!baseName) {
    return 'Unknown app';
  }

  return baseName.replace(/\b\w/g, (match) => match.toUpperCase());
}

module.exports = {
  getFocusedWindow,
  focusWindowByPid,
  isAvailable: () => USE_NATIVE_FOCUS && nativeFocus !== null,
};
