# Starts the local browser stack for the job agent:
#   1. Chrome with a dedicated profile and a local debug port (you sign in to job sites here, once)
#   2. the browser-use service that drives that Chrome with Gemini
# Run from the project root:  npm run browser     (leave it running while applying)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Load .env so the service sees GEMINI_API_KEY and BROWSER_SERVICE_TOKEN.
if (Test-Path "$root\.env") {
  Get-Content "$root\.env" | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), "Process")
    }
  }
}
if (-not $env:BROWSER_SERVICE_TOKEN) { throw "Set BROWSER_SERVICE_TOKEN in .env (any long random string)." }
if (-not $env:GEMINI_API_KEY -and -not $env:GOOGLE_API_KEY) { throw "Set GEMINI_API_KEY in .env." }

$port = if ($env:CHROME_DEBUG_PORT) { $env:CHROME_DEBUG_PORT } else { "9222" }
$profile = if ($env:CHROME_PROFILE_DIR) { $env:CHROME_PROFILE_DIR } else { "$root\.chrome-profile" }

function Test-Chrome {
  try { Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2 | Out-Null; $true } catch { $false }
}

if (-not (Test-Chrome)) {
  $candidates = @(
    $env:CHROME_PATH,
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $chrome = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $chrome) { throw "Chrome not found. Set CHROME_PATH in .env." }
  Write-Host "Opening Chrome (profile: $profile)"
  Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=$port",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=`"$profile`"",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  )
  for ($i = 0; $i -lt 30 -and -not (Test-Chrome); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Chrome)) { throw "Chrome did not open debug port $port. Close other Chrome windows using that profile and retry." }
} else {
  Write-Host "Chrome already running on port $port"
}

Write-Host ""
Write-Host "Sign in to the job sites you use in that Chrome window (once; it remembers)."
Write-Host "Starting browser-use service on http://127.0.0.1:8765  (Ctrl+C to stop)"
Write-Host ""

# No --reload: it breaks subprocess handling on Windows.
uv run --python 3.12 --project "$root\browser-service" uvicorn server:app --app-dir "$root\browser-service" --host 127.0.0.1 --port 8765
