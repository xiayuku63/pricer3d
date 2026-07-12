$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repo 'PrusaSlicer-2.9.6-setup.exe'
$envFile = Join-Path $repo '.env'

function Get-PrusaCandidates {
    $candidates = @()
    if ($env:PRUSA_EXECUTABLE) { $candidates += $env:PRUSA_EXECUTABLE }
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^PRUSA_EXECUTABLE=' } | Select-Object -First 1
        if ($line) {
            $value = ($line -replace '^PRUSA_EXECUTABLE=', '').Trim().Trim('"')
            if ($value) { $candidates += $value }
        }
    }
    $candidates += @(
        'C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe',
        'C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe',
        'C:\Program Files (x86)\Prusa3D\PrusaSlicer\prusa-slicer-console.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\PrusaSlicer\prusa-slicer-console.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\PrusaSlicer\prusa-slicer.exe')
    )
    $candidates | Select-Object -Unique
}

function Find-PrusaExecutable {
    foreach ($candidate in Get-PrusaCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Set-Or-AddEnvLine([string]$path, [string]$key, [string]$value) {
    $lines = @()
    if (Test-Path $path) { $lines = [System.Collections.Generic.List[string]](Get-Content $path) }
    $prefix = "$key="
    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].StartsWith($prefix)) {
            $lines[$i] = "$key=$value"
            $updated = $true
            break
        }
    }
    if (-not $updated) { $lines.Add("$key=$value") }
    Set-Content -Path $path -Value $lines -Encoding UTF8
}

$exe = Find-PrusaExecutable
if (-not $exe) {
    if (-not (Test-Path -LiteralPath $installer)) {
        throw "PrusaSlicer installer not found: $installer"
    }
    Write-Host '[pricer3d] installing PrusaSlicer silently...'
    $proc = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -PassThru -Wait -WindowStyle Hidden
    if ($proc.ExitCode -ne 0) {
        throw "PrusaSlicer installer failed with exit code $($proc.ExitCode)"
    }
    $exe = Find-PrusaExecutable
}

if (-not $exe) {
    throw 'PrusaSlicer installation finished but executable was not found.'
}

$env:PRUSA_EXECUTABLE = $exe
Set-Or-AddEnvLine -path $envFile -key 'PRUSA_EXECUTABLE' -value $exe
Write-Output $exe
