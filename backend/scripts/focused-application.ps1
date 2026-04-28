param(
  [string]$Action = 'get'
)

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$source = @"
using System;
using System.Runtime.InteropServices;

public static class FaderDeckFocusBridge {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

if (-not ("FaderDeckFocusBridge" -as [type])) {
  Add-Type -TypeDefinition $source -Language CSharp
}

function Get-FocusedApplicationPayload {
  $windowHandle = [FaderDeckFocusBridge]::GetForegroundWindow()

  if ($windowHandle -eq [IntPtr]::Zero) {
    return [pscustomobject]@{
      success = $false
      error = 'no-foreground-window'
    }
  }

  [uint32]$processId = 0
  [void][FaderDeckFocusBridge]::GetWindowThreadProcessId($windowHandle, [ref]$processId)

  if ($processId -le 0) {
    return [pscustomobject]@{
      success = $false
      error = 'missing-process-id'
    }
  }

  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    $processName = try { "$($process.ProcessName).exe" } catch { '' }
    $processNameRaw = try { [string]$process.ProcessName } catch { '' }
    $processPath = try { [string]$process.Path } catch { '' }
    $windowTitle = try { [string]$process.MainWindowTitle } catch { '' }
    $displayName = if ([string]::IsNullOrWhiteSpace($processName)) {
      'Unknown app'
    } else {
      [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ToTitleCase(
        $processName.Replace('.exe', '').Replace('_', ' ').Replace('-', ' ').ToLowerInvariant()
      )
    }

    return [pscustomobject]@{
      success = $true
      application = [pscustomobject]@{
        pid = [int]$processId
        process = $processName
        processName = $processNameRaw
        'path' = $processPath
        mainWindowTitle = $windowTitle
        name = $displayName
        hasWindow = -not [string]::IsNullOrWhiteSpace($windowTitle)
      }
    }
  } catch {
    return [pscustomobject]@{
      success = $false
      error = 'process-not-found'
      processId = [int]$processId
    }
  }
}

if ($Action -eq 'serve') {
  while ($true) {
    $line = [Console]::In.ReadLine()

    if ($null -eq $line) {
      break
    }

    $trimmedLine = [string]$line

    if ([string]::IsNullOrWhiteSpace($trimmedLine)) {
      continue
    }

    try {
      $request = $trimmedLine | ConvertFrom-Json -ErrorAction Stop
      $requestId = [string]$request.id
      $payload = Get-FocusedApplicationPayload

      [pscustomobject]@{
        id = $requestId
        ok = $true
        result = $payload
      } | ConvertTo-Json -Compress -Depth 6
    } catch {
      [pscustomobject]@{
        id = ''
        ok = $false
        error = 'focused-application-worker-parse-failed'
      } | ConvertTo-Json -Compress
    }
  }

  exit 0
}

Get-FocusedApplicationPayload | ConvertTo-Json -Compress -Depth 4
