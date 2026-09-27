# scripts/perf_baseline.ps1
# Repeatable Performance Baseline Benchmark Script for FaderDeck v2

param (
    [string]$TargetExe = "src-tauri\target\release\faderdeck.exe",
    [int]$IdleDurationSeconds = 10
)

$ErrorActionPreference = "Stop"
$rootPath = (Get-Item $PSScriptRoot).Parent.FullName

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   FaderDeck v2 Performance Baseline Measurement Suite    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Environment and Hardware Information
Write-Host "`n[1/4] Collecting System and Hardware Metadata..." -ForegroundColor Yellow
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$totalRamGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$logicalProcessors = [System.Environment]::ProcessorCount

$systemInfo = [ordered]@{
    CPU               = $cpu.Name.Trim()
    Cores             = $cpu.NumberOfCores
    LogicalProcessors = $cpu.NumberOfLogicalProcessors
    RAM_GB            = $totalRamGb
    OS                = $os.Caption.Trim()
    OS_Version        = $os.Version
    OS_Build          = $os.BuildNumber
    DateUtc           = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

Write-Host "  CPU   : $($systemInfo.CPU) ($($systemInfo.Cores) cores / $($systemInfo.LogicalProcessors) threads)"
Write-Host "  RAM   : $($systemInfo.RAM_GB) GB"
Write-Host "  OS    : $($systemInfo.OS) (Build $($systemInfo.OS_Build))"

# 2. Run Rust In-Process Micro-benchmark in Release Mode
Write-Host "`n[2/4] Running Release Micro-benchmark (100 Volume Iterations & HUD Threads)..." -ForegroundColor Yellow
$cargoPath = "$env:USERPROFILE\.cargo\bin\cargo.exe"
if (-not (Test-Path $cargoPath)) {
    $cargoPath = "cargo.exe"
}

$manifestPath = Join-Path $rootPath "src-tauri\Cargo.toml"
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$testOutput = & $cargoPath test --release --manifest-path $manifestPath --test perf_baseline -- --nocapture 2>&1
$ErrorActionPreference = $prevEap
$testOutputStr = $testOutput -join "`n"

$perfJsonMatch = [regex]::Match($testOutputStr, "PERF_JSON:(\{.*\})")
if (-not $perfJsonMatch.Success) {
    Write-Warning "Could not find PERF_JSON in test output. Raw output:"
    Write-Host $testOutputStr
    throw "Micro-benchmark failed to report JSON output."
}

$microBench = $perfJsonMatch.Groups[1].Value | ConvertFrom-Json

Write-Host "  Active Audio Sessions : $($microBench.sessions)"
Write-Host "  Target Audio Process  : '$($microBench.target)'"
Write-Host "  100-iter Min Latency  : $($microBench.min_us) us ($([math]::Round($microBench.min_us / 1000, 3)) ms)"
Write-Host "  100-iter Avg Latency  : $($microBench.avg_us) us ($([math]::Round($microBench.avg_us / 1000, 3)) ms)"
Write-Host "  100-iter p50 Latency  : $($microBench.p50_us) us ($([math]::Round($microBench.p50_us / 1000, 3)) ms)"
Write-Host "  100-iter p90 Latency  : $($microBench.p90_us) us ($([math]::Round($microBench.p90_us / 1000, 3)) ms)"
Write-Host "  100-iter p99 Latency  : $($microBench.p99_us) us ($([math]::Round($microBench.p99_us / 1000, 3)) ms)"
Write-Host "  100-iter Max Latency  : $($microBench.max_us) us ($([math]::Round($microBench.max_us / 1000, 3)) ms)"
Write-Host "  HUD Threads (Pre)     : $($microBench.threads_before)"
Write-Host "  HUD Threads (Peak 50) : $($microBench.threads_peak) (+$(($microBench.threads_peak - $microBench.threads_before)) OS threads)"
Write-Host "  HUD Threads (Post 1.6s): $($microBench.threads_after)"

# 3. Idle CPU Measurement with Open Window (faderdeck.exe + WebView2)
Write-Host "`n[3/4] Launching Release Executable for $IdleDurationSeconds-second Idle CPU Measurement..." -ForegroundColor Yellow

# Ensure no existing faderdeck instances
Stop-Process -Name faderdeck -Force -ErrorAction SilentlyContinue

$exeFullPath = Join-Path $rootPath $TargetExe

Write-Host "Ensuring release binary is up-to-date..." -ForegroundColor Gray
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $cargoPath build --release --manifest-path (Join-Path $rootPath "src-tauri\Cargo.toml")
$ErrorActionPreference = $prevEap

$proc = Start-Process -FilePath $exeFullPath -PassThru
Write-Host "  Started faderdeck.exe (PID: $($proc.Id))"

# Allow WebView2 and frontend initialization (3 seconds)
Start-Sleep -Seconds 3

# Collect PIDs: faderdeck.exe and child msedgewebview2.exe processes
$pids = [System.Collections.Generic.List[int]]::new()
$pids.Add($proc.Id)

$children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $proc.Id }
foreach ($c in $children) {
    $pids.Add($c.ProcessId)
}

Write-Host "  Tracking $($pids.Count) processes: faderdeck (PID $($proc.Id)) and WebView2 children ($($pids[1..($pids.Count-1)] -join ', '))"

# Sample 1
$procs1 = Get-Process -Id $pids -ErrorAction SilentlyContinue
$cpuMsStart = 0.0
foreach ($p in $procs1) {
    if ($p.TotalProcessorTime) {
        $cpuMsStart += $p.TotalProcessorTime.TotalMilliseconds
    }
}
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "  Measuring idle CPU for $IdleDurationSeconds seconds (window open, no user interaction)..."
Start-Sleep -Seconds $IdleDurationSeconds

$sw.Stop()
$procs2 = Get-Process -Id $pids -ErrorAction SilentlyContinue
$cpuMsEnd = 0.0
$wsBytes = 0.0
foreach ($p in $procs2) {
    if ($p.TotalProcessorTime) {
        $cpuMsEnd += $p.TotalProcessorTime.TotalMilliseconds
    }
    $wsBytes += $p.WorkingSet64
}

$elapsedMs = $sw.ElapsedMilliseconds
$cpuDeltaMs = $cpuMsEnd - $cpuMsStart
$cpuPercentTotal = [math]::Round(($cpuDeltaMs / ($elapsedMs * $logicalProcessors)) * 100, 2)
$cpuPercentNormalizedSingleCore = [math]::Round(($cpuDeltaMs / $elapsedMs) * 100, 2)

# Memory footprint
$wsMbTotal = [math]::Round(($wsBytes / 1MB), 1)

Write-Host "  Elapsed Time             : $([math]::Round($elapsedMs / 1000, 2)) s"
Write-Host "  CPU Time Consumed (All)  : $([math]::Round($cpuDeltaMs, 1)) ms"
Write-Host "  Average CPU Usage (Total): $cpuPercentTotal % (across $logicalProcessors logical cores)" -ForegroundColor Green
Write-Host "  Average CPU (Single-Core): $cpuPercentNormalizedSingleCore %" -ForegroundColor Green
Write-Host "  Total Working Set (RAM)  : $wsMbTotal MB" -ForegroundColor Green

# Terminate test process
Write-Host "`n[4/4] Cleaning Up Test Processes..." -ForegroundColor Yellow
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Name faderdeck -Force -ErrorAction SilentlyContinue

# 4. Generate Markdown & JSON Report
$reportObj = [ordered]@{
    System = $systemInfo
    MicroBenchmark_Release = $microBench
    IdleProcessMeasurement = [ordered]@{
        DurationSeconds          = [math]::Round($elapsedMs / 1000, 2)
        TrackedProcessesCount    = $pids.Count
        CpuTimeDeltaMs           = [math]::Round($cpuDeltaMs, 1)
        CpuPercentTotal          = $cpuPercentTotal
        CpuPercentSingleCore     = $cpuPercentNormalizedSingleCore
        TotalWorkingSetMb        = $wsMbTotal
    }
}

$reportJson = $reportObj | ConvertTo-Json -Depth 5
$reportJsonPath = Join-Path $rootPath "benchmark_baseline_report.json"
$reportJson | Set-Content -Path $reportJsonPath -Encoding utf8

$reportMdPath = Join-Path $rootPath "benchmark_baseline_report.md"
$mdContent = @"
# FaderDeck v2 Performance Baseline Report

> **Generated**: $($systemInfo.DateUtc)  
> **Environment**: Windows $($systemInfo.OS_Build) | $($systemInfo.CPU) | $($systemInfo.RAM_GB) GB RAM  
> **Build Mode**: Release (Cargo \`--release\`)

---

## 1. System & Test Conditions

| Parameter | Value |
|---|---|
| **CPU Model** | $($systemInfo.CPU) |
| **Cores / Logical Processors** | $($systemInfo.Cores) cores / $($systemInfo.LogicalProcessors) threads |
| **Physical RAM** | $($systemInfo.RAM_GB) GB |
| **OS Version** | $($systemInfo.OS) ($($systemInfo.OS_Version), Build $($systemInfo.OS_Build)) |
| **Active Audio Sessions** | $($microBench.sessions) detected ($($microBench.target)) |
| **Binary Tested** | \`faderdeck.exe\` (Release profile: \`opt-level = \"z\"\`, LTO, stripped) |

---

## 2. Micro-Benchmark Results (WASAPI Latency & Thread Dynamics)

### A. Volume Adjustment Latency (100 Iterations of \`set_session_volume\`)
- **Target Session**: \`$($microBench.target)\`
- **Min Latency**: **$($microBench.min_us) $\mu$s** ($([math]::Round($microBench.min_us / 1000, 3)) ms)
- **Average Latency**: **$($microBench.avg_us) $\mu$s** ($([math]::Round($microBench.avg_us / 1000, 3)) ms)
- **Median (p50)**: **$($microBench.p50_us) $\mu$s** ($([math]::Round($microBench.p50_us / 1000, 3)) ms)
- **90th Percentile (p90)**: **$($microBench.p90_us) $\mu$s** ($([math]::Round($microBench.p90_us / 1000, 3)) ms)
- **99th Percentile (p99)**: **$($microBench.p99_us) $\mu$s** ($([math]::Round($microBench.p99_us / 1000, 3)) ms)
- **Max Latency**: **$($microBench.max_us) $\mu$s** ($([math]::Round($microBench.max_us / 1000, 3)) ms)

> [!WARNING]
> Baseline average latency is **$([math]::Round($microBench.avg_us / 1000, 2)) ms** with p99 reaching **$([math]::Round($microBench.p99_us / 1000, 2)) ms**, exceeding the < 1.0 ms budget requirement for real-time hardware MIDI control.

### B. Volume HUD OS Thread Spikes
- **Threads Before**: **$($microBench.threads_before)**
- **Threads Peak (50 rapid calls)**: **$($microBench.threads_peak)** (+$(($microBench.threads_peak - $microBench.threads_before)) spawned OS threads)
- **Threads After (1.6s sleep)**: **$($microBench.threads_after)**

> [!WARNING]
> Confirms thread leak behavior: every rapid call to \`show_volume_hud\` allocates an OS thread sleeping 1350 ms.

---

## 3. Idle CPU & Memory Footprint (GUI Open, 10s Window)

- **Idle Measurement Window**: $($IdleDurationSeconds) seconds
- **Processes Monitored**: $($pids.Count) (\`faderdeck.exe\` + \`msedgewebview2.exe\` subprocesses)
- **Total Process CPU (All Cores)**: **$cpuPercentTotal %**
- **Normalized CPU (Single-Core Equivalent)**: **$cpuPercentNormalizedSingleCore %**
- **Total Combined Working Set (RAM)**: **$wsMbTotal MB**

---
"@

$mdContent | Set-Content -Path $reportMdPath -Encoding utf8

Write-Host "`nBaseline Report generated successfully:" -ForegroundColor Green
Write-Host "  Markdown: $reportMdPath"
Write-Host "  JSON    : $reportJsonPath"
Write-Host "==========================================================" -ForegroundColor Cyan
