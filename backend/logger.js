const electronLog = require('electron-log/main');

let initialized = false;

function initializeLogger() {
  if (initialized) {
    return electronLog;
  }

  initialized = true;
  electronLog.initialize();
  electronLog.transports.file.level = 'info';
  electronLog.transports.console.level = process.env.NODE_ENV === 'production' ? 'warn' : 'debug';

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
