const nativeProcesses = require('../backend/native-processes');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { performance } = require('perf_hooks');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, '../backend/scripts/process-list.ps1');

async function benchmarkNativeProcesses(iterations = 50) {
  console.log(`[benchmark] Running native process list benchmark (${iterations} iterations)...`);

  const latencies = [];

  // Cold start
  const coldStart = performance.now();
  await nativeProcesses.listProcesses();
  const coldLatency = performance.now() - coldStart;

  // Warm calls
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await nativeProcesses.listProcesses();
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

async function benchmarkPowerShellProcesses(iterations = 50) {
  console.log(`[benchmark] Running PowerShell process list benchmark (${iterations} iterations)...`);

  const latencies = [];

  // Cold start
  const coldStart = performance.now();
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );
  const coldLatency = performance.now() - coldStart;

  // Warm calls
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
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
    coldStart: 200,
    avg: 100,
    p95: 150,
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
  console.log('\n[benchmark] Process List Latency Benchmark');
  console.log('='.repeat(60));

  if (!nativeProcesses.isAvailable()) {
    console.error('\n[benchmark] ❌ Native processes module not available');
    console.error('[benchmark] Build the native module first: cd faderdeck-native && npm run build');
    process.exit(1);
  }

  try {
    const nativeResults = await benchmarkNativeProcesses();
    printResults('Native Rust', nativeResults);

    const psResults = await benchmarkPowerShellProcesses();
    printResults('PowerShell One-Shot', psResults);

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
