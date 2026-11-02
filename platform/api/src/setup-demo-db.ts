import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { loadPlatformEnv } from './load-env.js';

/**
 * Dựng cơ sở dữ liệu DEMO cục bộ để chạy thử toàn bộ ứng dụng (không cần dữ liệu thật):
 * migration 001-003, địa bàn minh họa Xuân Hương (mã 24781), rồi migration 005 trở đi.
 * Bỏ 004 vì file đó cắt ranh giới theo dữ liệu thật của phường, chỉ chạy được trên bản sao production.
 * Chỉ chạy với PostgreSQL trên máy này (localhost/127.0.0.1) để không bao giờ chạm vào máy chủ thật.
 */
loadPlatformEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Thiếu DATABASE_URL (xem platform/.env.example).');
const host = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  throw new Error(`Từ chối: DATABASE_URL trỏ tới "${host}". Lệnh này chỉ dành cho cơ sở dữ liệu demo trên máy bạn.`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database');
const migration = (prefix: string) => {
  const file = fs.readdirSync(path.join(root, 'migrations')).find((name) => name.startsWith(`${prefix}_`) && name.endsWith('.sql'));
  if (!file) throw new Error(`Không thấy migration ${prefix}`);
  return { name: file, sql: fs.readFileSync(path.join(root, 'migrations', file), 'utf8') };
};

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const existing = await client.query<{ present: boolean }>(`SELECT to_regclass('public.localities') IS NOT NULL AS present`);
  if (existing.rows[0]?.present) {
    const { rows } = await client.query<{ count: string }>('SELECT count(*) FROM localities');
    if (Number(rows[0]?.count) > 0) {
      console.log('Cơ sở dữ liệu đã có dữ liệu địa bàn: không làm gì thêm. Muốn dựng lại, hãy xóa volume Docker rồi chạy lại.');
      process.exit(0);
    }
  }
  const steps: Array<{ name: string; sql: string }> = ['001', '002', '003'].map(migration);
  steps.push({ name: 'seed/fixture.sql (địa bàn demo 24781)', sql: fs.readFileSync(path.join(root, 'seed', 'fixture.sql'), 'utf8').replaceAll('DEMO-DA-LAT', '24781') });
  const later = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql') && Number(name.slice(0, 3)) >= 5).sort();
  for (const name of later) steps.push({ name, sql: fs.readFileSync(path.join(root, 'migrations', name), 'utf8') });
  for (const step of steps) {
    await client.query(step.sql);
    console.log(`Đã áp dụng ${step.name}`);
  }
  console.log('Xong. Dữ liệu demo gồm địa bàn Xuân Hương (mã 24781); đăng nhập bằng tài khoản trong platform/.env.');
} finally {
  await client.end();
}
