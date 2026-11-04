# Build ban phat hanh web + API tren may Windows va dong goi thanh file zip de dua len VPS.
# Chay trong thu muc platform:  powershell -ExecutionPolicy Bypass -File .\build-release.ps1
# Ket qua: release-YYYYMMDD-HHmm.zip (gom web/, api/, migrations/). Tai len VPS bang MobaXterm roi chay ops/deploy-release.sh.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "1/4 Kiem tra kieu va test..."
npm run typecheck; if ($LASTEXITCODE -ne 0) { throw 'typecheck loi, dung lai.' }
npm test; if ($LASTEXITCODE -ne 0) { throw 'test loi, dung lai.' }

Write-Host "2/4 Build API va web..."
npm run build -w @cskv/api; if ($LASTEXITCODE -ne 0) { throw 'build API loi.' }
npm run build -w @cskv/web; if ($LASTEXITCODE -ne 0) { throw 'build web loi.' }

Write-Host "3/4 Dong goi..."
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$stage = Join-Path $env:TEMP "cskv-release-$stamp"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path "$stage\web","$stage\api","$stage\migrations" | Out-Null
Copy-Item -Recurse -Force "web\dist\*" "$stage\web\"
Copy-Item -Recurse -Force "api\dist\*" "$stage\api\"
Copy-Item -Force "database\migrations\*.sql" "$stage\migrations\"
$zip = Join-Path $PSScriptRoot "release-$stamp.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path "$stage\*" -DestinationPath $zip
Remove-Item -Recurse -Force $stage

Write-Host "4/4 Xong."
Get-Item $zip | Select-Object FullName, Length
Get-FileHash $zip -Algorithm SHA256
Write-Host "Tiep theo: tai file zip len VPS (MobaXterm, keo tha vao /root hoac /tmp), roi tren VPS chay:"
Write-Host "  bash /opt/dataforlife/repo/platform/ops/deploy-release.sh /duong/dan/$(Split-Path $zip -Leaf)"
Write-Host "(Neu VPS chua co ops/deploy-release.sh, tai them file nay len cung luc va chay bang bash.)"
