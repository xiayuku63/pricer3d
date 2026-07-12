$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$python = Join-Path $repo 'venv\Scripts\python.exe'
$logDir = Join-Path $repo 'logs'
$outLog = Join-Path $logDir 'windows-service.out.log'
$errLog = Join-Path $logDir 'windows-service.err.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Pricer3DHealthy {
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5000/healthz' -TimeoutSec 3
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "找不到虚拟环境 Python：$python"
}

if (Test-Pricer3DHealthy) {
    Write-Host "pricer3d 已在 127.0.0.1:5000 正常运行，跳过启动。"
    exit 0
}

Write-Host "[pricer3d] launching on http://127.0.0.1:5000"
$env:PORT = '5000'
$env:UVICORN_HOST = '127.0.0.1'
$env:UVICORN_RELOAD = 'false'
$env:PYTHONUNBUFFERED = '1'

$ensurePrusa = Join-Path $PSScriptRoot 'ensure_prusaslicer_windows.ps1'
if (Test-Path -LiteralPath $ensurePrusa) {
    $resolvedPrusa = powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensurePrusa | Select-Object -Last 1
    if ($resolvedPrusa) {
        $env:PRUSA_EXECUTABLE = $resolvedPrusa.Trim()
        Write-Host "[pricer3d] using PrusaSlicer: $env:PRUSA_EXECUTABLE"
    }
}

# Ensure localhost resolves via IPv6 (::1) as well as IPv4 (127.0.0.1).
try {
    $existingProxy = netsh interface portproxy show v6tov4 | Select-String -Pattern '::1\s+5000\s+127.0.0.1\s+5000'
    if (-not $existingProxy) {
        netsh interface portproxy add v6tov4 listenaddress=::1 listenport=5000 connectaddress=127.0.0.1 connectport=5000 | Out-Null
    }
} catch {
    Write-Warning "portproxy setup failed: $($_.Exception.Message)"
}

$proc = Start-Process -FilePath $python -ArgumentList 'main.py' -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Pricer3DHealthy) {
        Write-Host "[pricer3d] started pid=$($proc.Id)"
        exit 0
    }
}

throw "5000 端口未成功提供健康检查，请查看日志：$outLog / $errLog"
