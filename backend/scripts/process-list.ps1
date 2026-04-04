[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$windowTitles = @{}

Get-Process |
  Where-Object { $_.Id -gt 0 -and $_.MainWindowTitle } |
  ForEach-Object {
    $windowTitles[[int]$_.Id] = $_.MainWindowTitle
  }

 $items = Get-CimInstance Win32_Process |
  Where-Object { $_.ProcessId -gt 0 -and $_.Name } |
  ForEach-Object {
    [PSCustomObject]@{
      Process = $_.Name
      ProcessName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
      Path = $_.ExecutablePath
      MainWindowTitle = $windowTitles[[int]$_.ProcessId]
      Id = [int]$_.ProcessId
    }
  }

$items | ConvertTo-Json -Compress
