param(
  [int]$Port = 9224,
  [int]$FeedbackTimeoutMs = 500,
  [int]$CaptureTimeoutSeconds = 10,
  [int]$MaxCaptureDelayMs = 2000,
  [string]$ProcessName = 'LinguaLens'
)

$mainProcess = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'LinguaLens' } |
  Select-Object -First 1
if (-not $mainProcess) {
  throw 'LinguaLens main window is not running.'
}

$watch = [System.Diagnostics.Stopwatch]::StartNew()
node scripts/debug-capture-click.js $Port click | Out-Null
Start-Sleep -Milliseconds $FeedbackTimeoutMs

$captureProcess = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq '选择翻译区域' } |
  Select-Object -First 1
if (-not $captureProcess) {
  $statusMessage = node scripts/debug-capture-click.js $Port status | ConvertFrom-Json
  $statusText = $statusMessage.result.result.value
  if ($statusText -eq '等待截取') {
    throw "FAIL no visible feedback after $FeedbackTimeoutMs ms."
  }
  Write-Output "feedback after $FeedbackTimeoutMs ms: $statusText"
}

$deadline = [DateTime]::UtcNow.AddSeconds($CaptureTimeoutSeconds)
do {
  $captureProcess = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq '选择翻译区域' } |
    Select-Object -First 1
  if ($captureProcess) {
    $watch.Stop()
    $elapsedMs = [Math]::Round($watch.Elapsed.TotalMilliseconds)
    if ($elapsedMs -gt $MaxCaptureDelayMs) {
      throw "FAIL capture window took $elapsedMs ms; expected at most $MaxCaptureDelayMs ms."
    }
    $previewMessage = node scripts/debug-capture-click.js $Port preview | ConvertFrom-Json
    $preview = $previewMessage.result.result.value
    if (-not $preview.loaded -or $preview.format -ne 'jpeg') {
      throw "FAIL capture preview was not ready: $($preview.error)"
    }
    Write-Output "PASS capture window appeared after $elapsedMs ms with $($preview.width)x$($preview.height) JPEG preview."
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

throw "FAIL capture window did not appear within $CaptureTimeoutSeconds seconds."