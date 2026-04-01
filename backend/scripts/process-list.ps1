[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$items = Get-Process |
  Where-Object { $_.Id -gt 0 -and $_.ProcessName } |
  ForEach-Object {
    [PSCustomObject]@{
      Process = if ($_.Path) { [System.IO.Path]::GetFileName($_.Path) } else { "$($_.ProcessName).exe" }
      ProcessName = $_.ProcessName
      Path = $_.Path
      MainWindowTitle = $_.MainWindowTitle
      Id = $_.Id
    }
  }

$items | ConvertTo-Json -Compress
