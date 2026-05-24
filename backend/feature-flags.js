const USE_NATIVE_FOCUS = process.env.FADERDECK_NATIVE_FOCUS !== 'false';
const USE_NATIVE_PROCESSES = process.env.FADERDECK_NATIVE_PROCESSES !== 'false';

module.exports = {
  USE_NATIVE_FOCUS,
  USE_NATIVE_PROCESSES,
};
