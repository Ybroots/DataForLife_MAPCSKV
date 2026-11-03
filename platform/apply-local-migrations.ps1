# Áp dụng migration 005-017 cho CSDL Docker cục bộ. Có sao lưu trước, dừng ngay khi có lỗi.
# Chạy: powershell -ExecutionPolicy Bypass -File .\apply-local-migrations.ps1   (trong thư mục platform, Docker Desktop đang chạy)
Set-Location $PSScriptRoot

docker compose ps postgres 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker chua chay hoac chua co container postgres. Mo Docker Desktop roi chay: docker compose up -d postgres"; exit 1 }

Write-Host "1/3 Sao luu CSDL..."
New-Item -ItemType Directory -Force -Path backups | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
docker compose exec -T postgres pg_dump -U cskv -Fc -f /tmp/truoc-migration.dump cskv
if ($LASTEXITCODE -ne 0) { Write-Host "Sao luu that bai, KHONG chay migration."; exit 1 }
$backup = "backups\truoc-migration-$stamp.dump"
docker compose cp postgres:/tmp/truoc-migration.dump $backup
if ($LASTEXITCODE -ne 0) { Write-Host "Khong chep duoc ban sao luu ra may, KHONG chay migration."; exit 1 }
Write-Host "   Da luu: $backup ($([math]::Round((Get-Item $backup).Length / 1MB, 1)) MB)"

Write-Host "2/3 Ap dung migration 005-017..."
foreach ($n in 5..17) {
  $f = Get-ChildItem database\migrations -Filter ("{0:D3}_*.sql" -f $n) | Select-Object -First 1
  if (-not $f) { Write-Host "Khong thay migration so $n"; exit 1 }
  Write-Host "== $($f.Name)"
  docker compose cp $f.FullName postgres:/tmp/m.sql
  docker compose exec -T postgres psql -U cskv -d cskv -v ON_ERROR_STOP=1 -q -f /tmp/m.sql
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "LOI o $($f.Name). Da dung lai. Ban sao luu truoc khi chay: $backup"
    Write-Host "Hay gui nguyen thong bao loi o tren cho Claude."
    exit 1
  }
}

Write-Host "3/3 Kiem tra ket qua..."
$check = @"
select 'bang citizen_accounts' as muc, (to_regclass('public.citizen_accounts') is not null)::text as ket_qua
union all select 'bang citizen_email_codes', (to_regclass('public.citizen_email_codes') is not null)::text
union all select 'bang citizen_account_events', (to_regclass('public.citizen_account_events') is not null)::text
union all select 'cot ma khoi phuc/email (can 6)', count(*)::text from information_schema.columns where table_name='citizen_accounts' and column_name in ('recovery_code_hash','recovery_code_created_at','assisted_reset_hash','email','email_verified_at','password_changed_at')
union all select 'khu vuc minh hoa Xuan Truong/Lam Vien (can 7)', count(*)::text from service_areas where source_system='pilot-demo-voronoi';
"@
docker compose exec -T postgres psql -U cskv -d cskv -c $check
Write-Host ""
Write-Host "Xong. Khoi dong lai API (npm run dev:api). Tinh nang lay lai mat khau dung duoc sau buoc nay."
