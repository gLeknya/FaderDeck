const path = require('path');
const { USE_NATIVE_PROCESSES } = require('./feature-flags');

let nativeProcesses = null;

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
  
  nativeProcesses = nativeModule;
  console.log('[native:process] Native module loaded successfully');
} catch (error) {
  console.warn('[native:process] Native module not available:', error.message);
  console.warn('[native:process] Will use PowerShell fallback');
}

/**
 * List all running processes with window information
 * @returns {Promise<Array>}
 */
async function listProcesses() {
  if (!USE_NATIVE_PROCESSES || !nativeProcesses) {
    return null; // Fallback to PowerShell in ProcessCatalog
  }

  const start = Date.now();

  try {
    const result = nativeProcesses.listProcesses();
    const latency = Date.now() - start;

    if (process.env.NODE_ENV === 'development') {
      console.log(`[native:process] Listed ${result.length} processes in ${latency}ms`);
    }

    // Transform to match PowerShell output format
    const uniqueApplications = new Map();

    result.forEach((proc) => {
      const processKey = proc.process.toLowerCase();
      const existing = uniqueApplications.get(processKey);

      if (existing) {
        existing.instanceCount += 1;

        if (!existing.mainWindowTitle && proc.mainWindowTitle) {
          existing.mainWindowTitle = proc.mainWindowTitle;
          existing.hasWindow = true;
        }

        return;
      }

      uniqueApplications.set(processKey, {
        name: humanizeProcessName(proc.process),
        process: proc.process,
        processName: proc.processName,
        path: proc.path,
        mainWindowTitle: proc.mainWindowTitle,
        hasWindow: proc.hasWindow,
        instanceCount: 1,
      });
    });

    return Array.from(uniqueApplications.values()).sort((left, right) => {
      if (left.hasWindow !== right.hasWindow) {
        return left.hasWindow ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  } catch (error) {
    const latency = Date.now() - start;
    console.error(`[native:process] Failed after ${latency}ms:`, error);
    console.log('[native:process] Activating PowerShell fallback');
    return null; // Fallback to PowerShell
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
  listProcesses,
  isAvailable: () => USE_NATIVE_PROCESSES && nativeProcesses !== null,
};
