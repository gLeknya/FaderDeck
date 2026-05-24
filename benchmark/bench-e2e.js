const { FaderDeckAPI } = require('../backend/api');
const { performance } = require('perf_hooks');

// This benchmark measures the FULL backend round-trip:
// API → Backend → Rust/PowerShell → Back

async function benchmarkEndToEndFocus(api, iterations = 100) {
  console.log(`\n[e2e-benchmark] Focused app end-to-end (${iterations} iterations)...`);

  const latencies = [];

  // Cold start (includes all initialization)
  const coldStart = performance.now();
  await api.getFocusedApplication();
  const coldLatency = performance.now() - coldStart;

  // Warm calls
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await api.getFocusedApplication();
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

async function benchmarkEndToEndProcessList(api, iterations = 50) {
  console.log(`\n[e2e-benchmark] Process list end-to-end (${iterations} iterations)...`);

  const latencies = [];

  // Cold start
  const coldStart = performance.now();
  await api.listRunningApplications();
  const coldLatency = performance.now() - coldStart;

  // Warm calls
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await api.listRunningApplications();
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

async function runEndToEndBenchmarks() {
  console.log('\n[e2e-benchmark] End-to-End Backend Benchmarks');
  console.log('='.repeat(60));
  console.log('[e2e-benchmark] Measuring: API → Backend → Rust/PowerShell → Back');
  console.log('[e2e-benchmark] (Does NOT include IPC overhead - backend only)');
  console.log('='.repeat(60));

  const api = new FaderDeckAPI({ debug: false });

  try {
    const focusResults = await benchmarkEndToEndFocus(api);
    printResults('Focused App (Backend)', focusResults);

    const processResults = await benchmarkEndToEndProcessList(api);
    printResults('Process List (Backend)', processResults);

    console.log('\n' + '='.repeat(60));
    console.log('[e2e-benchmark] Backend benchmarks complete');
    console.log('[e2e-benchmark] Add IPC overhead (~0.5-2ms) for full round-trip\n');

    return { focusResults, processResults };
  } catch (error) {
    console.error('\n[e2e-benchmark] ❌ Benchmark failed:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  runEndToEndBenchmarks()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runEndToEndBenchmarks };
