# Thêm danh sách cán bộ CSKV (Xuân Hương, Xuân Trường, Lâm Viên) vào CSDL Docker cục bộ. Chạy lại nhiều lần vẫn an toàn.
# Chạy: powershell -ExecutionPolicy Bypass -File .\apply-officers.ps1   (trong thư mục platform, Docker Desktop đang chạy)
Set-Location $PSScriptRoot

docker compose ps postgres 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker chua chay hoac chua co container postgres. Mo Docker Desktop roi chay: docker compose up -d postgres"; exit 1 }

$f = Get-Item database\migrations\018_cskv_officers.sql
Write-Host "Ap dung $($f.Name)..."
docker compose cp $f.FullName postgres:/tmp/m.sql
docker compose exec -T postgres psql -U cskv -d cskv -v ON_ERROR_STOP=1 -q -f /tmp/m.sql
if ($LASTEXITCODE -ne 0) { Write-Host "LOI. Hay gui nguyen thong bao loi o tren cho Claude."; exit 1 }

$check = @"
select l.code, l.name, count(*) as so_can_bo
from directory_entries d join localities l on l.id = d.locality_id
where d.source_system = 'cskv_roster' group by l.code, l.name order by l.code;
"@
docker compose exec -T postgres psql -U cskv -d cskv -c $check
Write-Host "Can: 24778 Lam Vien = 3, 24781 Xuan Huong = 19, 24805 Xuan Truong = 3."
Write-Host "Xong. Khong can khoi dong lai API; mo lai app la thay."
