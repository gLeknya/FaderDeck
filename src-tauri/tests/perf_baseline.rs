use faderdeck_lib::audio::{list_detected_sessions, set_session_volume};
use std::time::{Duration, Instant};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, THREADENTRY32, TH32CS_SNAPTHREAD,
};
use windows::Win32::System::Threading::GetCurrentProcessId;

fn get_process_thread_count(pid: u32) -> usize {
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) {
            Ok(s) => s,
            Err(_) => return 0,
        };

        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };

        let mut count = 0;
        if Thread32First(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32OwnerProcessID == pid {
                    count += 1;
                }
                if Thread32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
        count
    }
}

#[test]
fn perf_baseline_benchmark() {
    let current_pid = unsafe { GetCurrentProcessId() };
    println!("\n========================================================");
    println!("  FADERDECK v2 PERFORMANCE BASELINE BENCHMARK");
    println!("========================================================");

    // 1. Detect audio sessions
    let sessions = list_detected_sessions().unwrap_or_default();
    println!("Active WASAPI audio sessions detected: {}", sessions.len());
    for s in &sessions {
        println!("  - PID {}: '{}' (process: '{}', vol: {:.1}%, muted: {})",
            s.pid, s.process_name, s.process, s.volume, s.muted);
    }

    // Determine target process for testing
    let target_process = if let Some(s) = sessions.iter().find(|s| !s.process.is_empty()) {
        s.process.clone()
    } else {
        "master".to_string()
    };
    println!("\nTarget audio process for 100-iteration benchmark: '{}'", target_process);

    // Warmup (5 iterations)
    for _ in 0..5 {
        let _ = set_session_volume(&target_process, 50.0);
    }

    // Step breakdown test
    {
        use faderdeck_lib::audio::get_session_manager;
        use windows::Win32::Media::Audio::{IAudioSessionControl2, ISimpleAudioVolume};
        use windows::core::Interface;

        let t0 = Instant::now();
        let mgr = get_session_manager().unwrap();
        let t_mgr = t0.elapsed();

        let t1 = Instant::now();
        let enumerator = unsafe { mgr.GetSessionEnumerator().unwrap() };
        let t_enum = t1.elapsed();

        let t2 = Instant::now();
        let count = unsafe { enumerator.GetCount().unwrap() };
        let mut t_sav = Duration::ZERO;
        for i in 0..count {
            if let Ok(c) = unsafe { enumerator.GetSession(i) } {
                if let Ok(c2) = c.cast::<IAudioSessionControl2>() {
                    let _pid = unsafe { c2.GetProcessId().unwrap_or(0) };
                    if let Ok(sav) = c.cast::<ISimpleAudioVolume>() {
                        let t_s = Instant::now();
                        unsafe { let _ = sav.SetMasterVolume(0.5, std::ptr::null()); }
                        t_sav += t_s.elapsed();
                    }
                }
            }
        }
        let t_total_enum = t2.elapsed();

        println!("\n--- Step Breakdown (1 Call) ---");
        println!("  1. get_session_manager()      : {} us ({:.3} ms)", t_mgr.as_micros(), t_mgr.as_secs_f64() * 1000.0);
        println!("  2. GetSessionEnumerator()     : {} us ({:.3} ms)", t_enum.as_micros(), t_enum.as_secs_f64() * 1000.0);
        println!("  3. Loop all sessions & SetVol : {} us ({:.3} ms)", t_total_enum.as_micros(), t_total_enum.as_secs_f64() * 1000.0);
        println!("     - actual sav.SetMasterVolume : {} us ({:.3} ms)", t_sav.as_micros(), t_sav.as_secs_f64() * 1000.0);
    }

    // 2. Measure 100 iterations of set_session_volume
    let iterations = 100;
    let mut latencies_us = Vec::with_capacity(iterations);

    let total_start = Instant::now();
    for i in 0..iterations {
        let vol = 20.0 + (i % 60) as f64;
        let iter_start = Instant::now();
        let _ = set_session_volume(&target_process, vol);
        let elapsed = iter_start.elapsed();
        latencies_us.push(elapsed.as_micros() as u64);
    }
    let total_elapsed = total_start.elapsed();

    latencies_us.sort_unstable();
    let min_us = latencies_us[0];
    let max_us = latencies_us[latencies_us.len() - 1];
    let sum_us: u64 = latencies_us.iter().sum();
    let avg_us = sum_us as f64 / iterations as f64;
    let p50_us = latencies_us[(iterations * 50) / 100];
    let p90_us = latencies_us[(iterations * 90) / 100];
    let p99_us = latencies_us[(iterations * 99) / 100];

    println!("\n--- [PERF-1 Baseline] set_session_volume (100 iterations) ---");
    println!("Total time for 100 calls : {:.2} ms", total_elapsed.as_secs_f64() * 1000.0);
    println!("Min latency              : {} us ({:.3} ms)", min_us, min_us as f64 / 1000.0);
    println!("Average latency          : {:.1} us ({:.3} ms)", avg_us, avg_us / 1000.0);
    println!("Median (p50)             : {} us ({:.3} ms)", p50_us, p50_us as f64 / 1000.0);
    println!("90th percentile (p90)    : {} us ({:.3} ms)", p90_us, p90_us as f64 / 1000.0);
    println!("99th percentile (p99)    : {} us ({:.3} ms)", p99_us, p99_us as f64 / 1000.0);
    println!("Max latency              : {} us ({:.3} ms)", max_us, max_us as f64 / 1000.0);

    // 3. Measure Volume HUD thread dynamics (PERF-2: single debounced worker)
    println!("\n--- [PERF-2 Benchmark] Volume HUD Thread Dynamics (Single Persistent Worker) ---");
    let threads_before = get_process_thread_count(current_pid);
    println!("Thread count before dispatching : {}", threads_before);

    // Test debounced channel pattern matching hud_window.rs (50 rapid calls)
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let _worker = std::thread::Builder::new()
        .name("hud-test-worker".to_string())
        .spawn(move || {
            while rx.recv().is_ok() {
                while rx.try_recv().is_ok() {}
                loop {
                    match rx.recv_timeout(Duration::from_millis(1350)) {
                        Ok(_) => {
                            while rx.try_recv().is_ok() {}
                            continue;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
            }
        })
        .expect("failed to spawn test worker");

    for _ in 0..50 {
        let _ = tx.send(());
        std::thread::sleep(Duration::from_millis(2));
    }

    let threads_peak = get_process_thread_count(current_pid);
    println!("Thread count during rapid calls : {} (+{} threads)",
        threads_peak, threads_peak.saturating_sub(threads_before));

    // Wait for worker debounce to finish
    std::thread::sleep(Duration::from_millis(1500));
    drop(tx);
    let _ = _worker.join();
    let threads_after = get_process_thread_count(current_pid);
    println!("Thread count after cooldown     : {}", threads_after);
    println!("========================================================\n");

    // Output JSON line for programmatic parsing
    println!("PERF_JSON:{{\"sessions\":{},\"target\":\"{}\",\"min_us\":{},\"avg_us\":{:.1},\"p50_us\":{},\"p90_us\":{},\"p99_us\":{},\"max_us\":{},\"threads_before\":{},\"threads_peak\":{},\"threads_after\":{}}}",
        sessions.len(), target_process, min_us, avg_us, p50_us, p90_us, p99_us, max_us, threads_before, threads_peak, threads_after);
}
