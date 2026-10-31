// Bản Android dành cho người dân không được chứa cổng nghiệp vụ của cán bộ.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const dir = new URL('../dist-android/assets/', import.meta.url);
const files = (await readdir(dir)).filter((name) => name.endsWith('.js'));
assert.equal(files.filter((name) => /^PolicePortal-|^PoliceOperations-|^PoliceDutyMap-/.test(name)).length, 0,
  'Bản người dân không được đóng gói chunk cổng cán bộ (PolicePortal/PoliceOperations/PoliceDutyMap).');

// Giao diện và đường dẫn đăng nhập dành riêng cho cán bộ. Không kiểm '/v1/officer/': đó là nhánh `scope` của hàm
// getIncidentAttachmentUrl dùng chung, không có giao diện nào của bản người dân gọi tới.
const forbidden = ['/v1/auth/officer', 'Cán bộ Công an', 'Cổng nghiệp vụ', 'portal=police', 'Đăng nhập CSKV'];
for (const name of files) {
  const text = await readFile(new URL(name, dir), 'utf8');
  for (const needle of forbidden) assert(!text.includes(needle), `${name} chứa chuỗi dành cho cán bộ: ${needle}`);
}
console.log(`Citizen-only bundle verified: ${files.length} JS files, không có cổng cán bộ.`);
