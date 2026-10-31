// Chạy: npm test  (Node >= 22.6, dùng --experimental-strip-types; adapter chỉ import kiểu nên không cần build)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptAreaLookup, adaptAreaPlaceholders, adaptHotlines, adaptUnitContacts, communeFromLookup, entryLabel, unitCap,
} from '../src/services/DirectoryAdapter.ts';

// Mẫu lấy từ phản hồi thật của GET /v1/directory/units (rút gọn).
const units = [
  { id: 'u1', displayName: 'Nguyễn Văn Tiếp - Trưởng phòng', rank: null, roleTitle: null, phone: '0968.368.189', entryType: 'unit_contact' as const, unitCode: 'PC08', unitName: 'Phòng Cảnh sát giao thông', address: null },
  { id: 'u2', displayName: 'Trực ban', rank: null, roleTitle: 'Trực ban đồn', phone: '0263.111.222', entryType: 'unit_contact' as const, unitCode: 'DKCN1', unitName: 'Đồn Công an KCN Nhân Cơ', address: 'KCN Nhân Cơ' },
];

test('đơn vị: chỉ "Đồn ..." thuộc nhóm xã/đồn, còn lại là cấp phòng; không bịa dữ liệu', () => {
  const [phong, don] = adaptUnitContacts(units);
  assert.equal(phong!.communeInfo!.cap, 1);
  assert.equal(don!.communeInfo!.cap, 2);
  assert.equal(phong!.ma_xa, 'PC08');
  assert.equal(phong!.ten_xa, 'Phòng Cảnh sát giao thông');
  assert.equal(phong!.mobile, '0968.368.189');
  assert.equal(phong!.communeInfo!.dan_so, null);
  assert.equal(phong!.communeInfo!.ma_tinh, '');
  assert.equal(unitCap('  đồn công an x'), 2);
});

test('nhãn: không lặp chức danh đã có trong tên, thêm roleTitle khi chưa có', () => {
  assert.equal(entryLabel({ displayName: 'A - Trưởng phòng', roleTitle: 'Trưởng phòng' }), 'A - Trưởng phòng');
  assert.equal(entryLabel({ displayName: 'Trực ban', roleTitle: 'Trực ban đồn' }), 'Trực ban - Trực ban đồn');
  assert.equal(entryLabel({ displayName: 'B', roleTitle: null }), 'B');
});

test('hotline: nhóm theo categoryCode, cấp tỉnh', () => {
  const [h] = adaptHotlines([{ id: 'h1', categoryCode: 'emergency', categoryLabel: 'Khẩn cấp', label: 'Công an 113', phone: '113' }]);
  assert.equal(h!.ma_xa, 'HOTLINE-emergency');
  assert.equal(h!.ten_xa, 'Khẩn cấp');
  assert.equal(h!.fullName, 'Công an 113');
  assert.equal(h!.communeInfo!.cap, 3);
});

test('địa bàn: mục giữ chỗ không phải liên hệ và không có số liệu', () => {
  const [a] = adaptAreaPlaceholders({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: '24781', properties: { code: '24781', name: 'Xuân Hương - Đà Lạt', localityType: 'Phường', provinceName: 'Lâm Đồng' } }],
  });
  assert.equal(a!.placeholder, true);
  assert.equal(a!.ma_xa, '24781');
  assert.equal(a!.fullName, '');
  assert.equal(a!.mobile, null);
  assert.equal(a!.communeInfo!.cap, 2);
  assert.equal(a!.communeInfo!.dan_so, null);
});

const lookup = {
  code: '24781', name: 'Xuân Hương - Đà Lạt', localityType: 'Phường', provinceName: 'Lâm Đồng',
  population: null, areaKm2: 73.45, densityPerKm2: null, center: null,
  station: { name: 'Công an phường Xuân Hương', address: '1 Trần Phú', latitude: null, longitude: null, locationSource: 'address_only' as const },
  directory: [
    { id: 'd1', displayName: 'Lê Văn A', rank: null, roleTitle: 'Cảnh sát khu vực', phone: '0900000001', entryType: 'officer' as const },
    { id: 'd2', displayName: 'Số trực', rank: null, roleTitle: null, phone: '', entryType: 'unit_contact' as const },
  ],
};

test('lookup: số liệu thật hoặc null (không 0), đầu mối gắn đúng địa bàn', () => {
  const commune = communeFromLookup(lookup);
  assert.equal(commune.dan_so, null);
  assert.equal(commune.dtich_km2, 73.45);
  assert.equal(commune.address, '1 Trần Phú');
  const contacts = adaptAreaLookup(lookup);
  assert.equal(contacts.length, 2);
  assert.ok(contacts.every((c) => c.ma_xa === '24781' && c.ten_xa === 'Xuân Hương - Đà Lạt' && !c.placeholder));
  assert.equal(contacts[0]!.fullName, 'Lê Văn A - Cảnh sát khu vực');
  assert.equal(contacts[1]!.mobile, null);
});

test('lookup không có đầu mối: trả mảng rỗng, không văng lỗi', () => {
  assert.deepEqual(adaptAreaLookup({ ...lookup, directory: [] }), []);
});
