Set-Location -Path $PSScriptRoot

Write-Host "Instalando dependencias do Admin Desktop..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Gerando instalador EXE..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Build concluido! Veja a pasta dist\\ para o instalador." -ForegroundColor Green
