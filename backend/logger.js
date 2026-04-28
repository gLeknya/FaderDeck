const electronLog = require('electron-log/main');

let initialized = false;
let consoleTransportDisabled = false;

function isBrokenPipeError(error) {
  if (!error) {
    return false;
  }

  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();

  return (
    ['EPIPE', 'EOF', 'EBADF', 'ERR_STREAM_DESTROYED'].includes(code) ||
    message.includes('broken pipe') ||
    message.includes('epipe') ||
    message.includes('stream destroyed') ||
    message.includes('bad file descriptor')
  );
}

function disableConsoleTransport() {
  if (consoleTransportDisabled) {
    return;
  }

  consoleTransportDisabled = true;
  electronLog.transports.console.level = false;
}

function attachConsoleStreamGuards() {
  [process.stdout, process.stderr].forEach((stream) => {
    if (!stream || stream.__faderDeckLoggerGuardAttached) {
      return;
    }

    stream.__faderDeckLoggerGuardAttached = true;
    stream.on('error', (error) => {
      if (isBrokenPipeError(error)) {
        disableConsoleTransport();
      }
    });
  });
}

function initializeLogger() {
  if (initialized) {
    return electronLog;
  }

  initialized = true;
  electronLog.initialize();
  electronLog.transports.file.level = 'info';
  electronLog.transports.console.level =
    process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
  attachConsoleStreamGuards();

  const originalConsoleWriteFn = electronLog.transports.console.writeFn;

  electronLog.transports.console.writeFn = (payload) => {
    if (consoleTransportDisabled) {
      return;
    }

    try {
      return originalConsoleWriteFn(payload);
    } catch (error) {
      if (isBrokenPipeError(error)) {
        disableConsoleTransport();
        return;
      }

      throw error;
    }
  };

  electronLog.processInternalErrorFn = (error) => {
    if (isBrokenPipeError(error)) {
      disableConsoleTransport();
    }
  };

  return electronLog;
}

function createLogger(scope = 'app') {
  const logger = initializeLogger();
  const prefix = `[${scope}]`;

  return Object.freeze({
    error: (...args) => logger.error(prefix, ...args),
    warn: (...args) => logger.warn(prefix, ...args),
    info: (...args) => logger.info(prefix, ...args),
    verbose: (...args) => logger.verbose(prefix, ...args),
    debug: (...args) => logger.debug(prefix, ...args),
    silly: (...args) => logger.silly(prefix, ...args),
    log: (...args) => logger.info(prefix, ...args)
  });
}

module.exports = {
  createLogger,
  initializeLogger
};
