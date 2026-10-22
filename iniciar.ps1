<#
.SYNOPSIS
    Inicia o protótipo do Movie App (versão Vanilla Web) localmente.
.DESCRIPTION
    Garante a presença do arquivo de configuração (config.js) e serve a pasta web-vanilla
    utilizando Python (http.server), npx (serve) ou Node.js, abrindo o navegador automaticamente.
#>
[CmdletBinding()]
param(
    [int]$Porta = 8080,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Raiz = $PSScriptRoot
$PastaVanilla = Join-Path $Raiz 'web-vanilla'

# Garante a existência de config.js para a aplicação
$configJs = Join-Path $PastaVanilla 'config.js'
$configExemplo = Join-Path $PastaVanilla 'config.example.js'
if (-not (Test-Path $configJs) -and (Test-Path $configExemplo)) {
    Copy-Item $configExemplo $configJs
    Write-Host "==> Criado config.js a partir de config.example.js" -ForegroundColor Cyan
}

$url = "http://localhost:$Porta/"
Write-Host "==> Iniciando Movie App (Vanilla Web) em: $url" -ForegroundColor Green
Write-Host "==> Pressione Ctrl+C para encerrar o servidor.`n" -ForegroundColor Yellow

if (-not $NoBrowser) {
    Start-Process $url -ErrorAction SilentlyContinue
}

# 1. Tenta Python http.server (py launcher, python3 ou python)
$pyCmd = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    $test = & py -3 -c "import http.server" 2>$null
    if ($LASTEXITCODE -eq 0) { $pyCmd = "py" }
}
if (-not $pyCmd) {
    foreach ($cmd in @("python3", "python")) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) {
            $test = & $cmd -c "import http.server" 2>$null
            if ($LASTEXITCODE -eq 0) { $pyCmd = $cmd; break }
        }
    }
}

if ($pyCmd -eq "py") {
    Write-Host "==> Servidor: Python http.server (py -3)" -ForegroundColor Gray
    & py -3 -m http.server $Porta --directory $PastaVanilla
    exit $LASTEXITCODE
} elseif ($pyCmd) {
    Write-Host "==> Servidor: Python http.server ($pyCmd)" -ForegroundColor Gray
    & $pyCmd -m http.server $Porta --directory $PastaVanilla
    exit $LASTEXITCODE
}

# 2. Tenta npx serve
if (Get-Command npx -ErrorAction SilentlyContinue) {
    Write-Host "==> Servidor: npx serve" -ForegroundColor Gray
    & npx serve $PastaVanilla -l $Porta
    exit $LASTEXITCODE
}

# 3. Fallback: script Node.js dedicado do repositório
$serveMjs = Join-Path $Raiz 'scripts\serve.mjs'
if (Get-Command node -ErrorAction SilentlyContinue -and (Test-Path $serveMjs)) {
    Write-Host "==> Servidor: Node.js (scripts/serve.mjs)" -ForegroundColor Gray
    $env:PORT = "$Porta"
    & node $serveMjs
    exit $LASTEXITCODE
}

Write-Error "Nenhum servidor web encontrado. Instale Python 3 ou Node.js (npx)."
exit 1
