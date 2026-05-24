const nativeFocus = require('../backend/native-focus');
const { PowerShellServer } = require('../backend/powershell-server');
const path = require('path');
const { performance } = require('perf_hooks');

const FOCUSED_SCRIPT_PATH = path.join(
  __dirname,
  '../backend/scripts/focused-application.ps1'
);

async function benchmarkNativeFocus(iterations = 100) {
  console.log(`[benchmark] Running native focus benchmark (${iterations} iterations)...`);

  const latencies = [];

  // Cold start
  const coldStart = performance.now();
  await nativeFocus.getFocusedWindow();
  const coldLatency = performance.now() - coldStart;

  // Warm calls
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await nativeFocus.getFocusedWindow();
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  return {
    coldLatency,
    avg,
    p50,
    p95,
    p99,
    min,
    max,
  };
}

async function benchmarkPowerShellFocus(iterations = 100) {
  console.log(`[benchmark] Running PowerShell focus benchmark (${iterations} iterations)...`);

  const server = new PowerShellServer({
    log: () => {},
    scriptPath: FOCUSED_SCRIPT_PATH,
    spawnArgs: ['-Action', 'serve'],
    requestTimeoutMs: 3000,
    responseSuccessKey: 'ok',
    logPrefix: 'focused-application-bench',
    buffering: 'readline',
  });

  const latencies = [];

  // Cold start (includes worker spawn)
  const coldStart = performance.now();
  await server.run('get', {});
  const coldLatency = performance.now() - coldStart;

  // Warm calls
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await server.run('get', {});
    latencies.push(performance.now() - start);
  }

  server.shutdown();

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  return {
    coldLatency,
    avg,
    p50,
    p95,
    p99,
    min,
    max,
  };
}

function printResults(name, results) {
  console.log(`\n${name}:`);
  console.log(`  Cold start: ${results.coldLatency.toFixed(2)}ms`);
  console.log(`  Average:    ${results.avg.toFixed(2)}ms`);
  console.log(`  P50:        ${results.p50.toFixed(2)}ms`);
  console.log(`  P95:        ${results.p95.toFixed(2)}ms`);
  console.log(`  P99:        ${results.p99.toFixed(2)}ms`);
  console.log(`  Min:        ${results.min.toFixed(2)}ms`);
  console.log(`  Max:        ${results.max.toFixed(2)}ms`);
}

function printComparison(nativeResults, psResults) {
  console.log('\n[benchmark] Performance Comparison:');
  console.log('─'.repeat(60));

  const coldImprovement = (psResults.coldLatency / nativeResults.coldLatency).toFixed(2);
  const avgImprovement = (psResults.avg / nativeResults.avg).toFixed(2);
  const p95Improvement = (psResults.p95 / nativeResults.p95).toFixed(2);

  console.log(`Cold start: ${coldImprovement}x faster`);
  console.log(`Average:    ${avgImprovement}x faster`);
  console.log(`P95:        ${p95Improvement}x faster`);

  // Check targets
  console.log('\n[benchmark] Target Validation:');
  console.log('─'.repeat(60));

  const targets = {
    coldStart: 20,
    avg: 5,
    p95: 10,
  };

  const coldPass = nativeResults.coldLatency < targets.coldStart;
  const avgPass = nativeResults.avg < targets.avg;
  const p95Pass = nativeResults.p95 < targets.p95;

  console.log(`Cold start < ${targets.coldStart}ms: ${coldPass ? '✓ PASS' : '✗ FAIL'} (${nativeResults.coldLatency.toFixed(2)}ms)`);
  console.log(`Average < ${targets.avg}ms:    ${avgPass ? '✓ PASS' : '✗ FAIL'} (${nativeResults.avg.toFixed(2)}ms)`);
  console.log(`P95 < ${targets.p95}ms:        ${p95Pass ? '✓ PASS' : '✗ FAIL'} (${nativeResults.p95.toFixed(2)}ms)`);

  return coldPass && avgPass && p95Pass;
}

async function runBenchmark() {
  console.log('\n[benchmark] Focused App Latency Benchmark');
  console.log('='.repeat(60));

  if (!nativeFocus.isAvailable()) {
    console.error('\n[benchmark] ❌ Native focus module not available');
    console.error('[benchmark] Build the native module first: cd faderdeck-native && npm run build');
    process.exit(1);
  }

  try {
    const nativeResults = await benchmarkNativeFocus();
    printResults('Native Rust', nativeResults);

    const psResults = await benchmarkPowerShellFocus();
    printResults('PowerShell Worker', psResults);

    const allTargetsMet = printComparison(nativeResults, psResults);

    console.log('\n' + '='.repeat(60));

    if (allTargetsMet) {
      console.log('[benchmark] ✓ All performance targets met\n');
      return { nativeResults, psResults, success: true };
    } else {
      console.log('[benchmark] ⚠️  Some performance targets not met\n');
      return { nativeResults, psResults, success: false };
    }
  } catch (error) {
    console.error('\n[benchmark] ❌ Benchmark failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runBenchmark();
}

module.exports = { runBenchmark };
