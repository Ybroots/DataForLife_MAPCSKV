# Nap DU LIEU MAU de trinh dien (180 tai khoan, 236 thiet bi, 96 phan anh, danh gia, 3 y kien) vao CSDL Docker cuc bo.
# CHI DUNG CHO MAY DEMO / CUC BO, khong nap len may chu chinh thuc.
# Nap:  powershell -ExecutionPolicy Bypass -File .\apply-demo-data.ps1
# Xoa:  powershell -ExecutionPolicy Bypass -File .\apply-demo-data.ps1 -Remove
param([switch]$Remove)
Set-Location $PSScriptRoot

docker compose ps postgres 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker chua chay hoac chua co container postgres. Mo Docker Desktop roi chay: docker compose up -d postgres"; exit 1 }

function Run-Sql($path) {
  docker compose cp (Get-Item $path).FullName postgres:/tmp/m.sql
  docker compose exec -T postgres psql -U cskv -d cskv -v ON_ERROR_STOP=1 -q -f /tmp/m.sql
  return $LASTEXITCODE
}

if ($Remove) {
  Write-Host "Xoa du lieu mau..."
  if ((Run-Sql "database\seed\demo-mock-data-remove.sql") -ne 0) { Write-Host "LOI. Gui nguyen thong bao loi cho Claude."; exit 1 }
  Write-Host "Da xoa du lieu mau."
  exit 0
}

Write-Host "1/3 Sao luu CSDL..."
New-Item -ItemType Directory -Force -Path backups | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
docker compose exec -T postgres pg_dump -U cskv -Fc -f /tmp/truoc-demo.dump cskv
if ($LASTEXITCODE -ne 0) { Write-Host "Sao luu that bai, KHONG nap du lieu."; exit 1 }
$backup = "backups\truoc-demo-$stamp.dump"
docker compose cp postgres:/tmp/truoc-demo.dump $backup
if ($LASTEXITCODE -ne 0) { Write-Host "Khong chep duoc ban sao luu, KHONG nap du lieu."; exit 1 }
Write-Host "   Da luu: $backup"

Write-Host "2/3 Ap dung migration 019 va du lieu mau..."
if ((Run-Sql "database\migrations\019_public_stats.sql") -ne 0) { Write-Host "LOI o migration 019. Ban sao luu: $backup. Gui nguyen thong bao loi cho Claude."; exit 1 }
if ((Run-Sql "database\seed\demo-mock-data.sql") -ne 0) { Write-Host "LOI o du lieu mau (da hoan tac, khong de lai du lieu do dang). Ban sao luu: $backup. Gui nguyen thong bao loi cho Claude."; exit 1 }

Write-Host "3/3 Kiem tra..."
$check = @"
select 'tai khoan mau' as muc, count(*)::text as so from citizen_accounts where id like 'demo-seed-%'
union all select 'thiet bi mau', count(*)::text from push_devices where token like 'demo-seed-%'
union all select 'phan anh mau', count(*)::text from incident_reports where citizen_external_id like 'demo-seed-%'
union all select 'y kien mau', count(*)::text from public_testimonials where is_demo;
"@
docker compose exec -T postgres psql -U cskv -d cskv -c $check
Write-Host "Xong. Khong can khoi dong lai API. Mo app, vao Tinh nang > Thong ke de xem so dem."
