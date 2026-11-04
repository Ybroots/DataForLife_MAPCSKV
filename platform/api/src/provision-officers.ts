import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { loadPlatformEnv } from './load-env.js';
import { hashPassword } from './password.js';

loadPlatformEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Missing DATABASE_URL');

const outputArgument = process.argv.find((argument) => argument.startsWith('--credentials-output='));
const outputPath = outputArgument?.slice('--credentials-output='.length);
if (!outputPath || !path.isAbsolute(outputPath)) {
  throw new Error('Use --credentials-output with an absolute path outside the repository.');
}

const created: Array<{ username: string; password: string; displayName: string }> = [];
mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
writeFileSync(outputPath, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });

const client = new Client({ connectionString: databaseUrl });
let connected = false;
let inTransaction = false;

try {
  await client.connect();
  connected = true;
  await client.query('BEGIN');
  inTransaction = true;
  const locality = await client.query<{ id: string }>('SELECT id::text FROM localities WHERE code = $1', ['24781']);
  const localityId = locality.rows[0]?.id;
  if (!localityId) throw new Error('Không tìm thấy địa bàn mã 24781 để gán tài khoản cán bộ.');

  // 5 tài khoản cán bộ khu vực (gắn khu vực ở migration 021) và 1 tài khoản chỉ huy (chỉ xem, không gắn khu vực).
  const accounts = [
    ...Array.from({ length: 5 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0');
      return { username: `canbo${suffix}`, actorId: `officer-cskv-${suffix}`, displayName: `Cán bộ CSKV ${suffix}`, actorType: 'officer' };
    }),
    { username: 'chihuy01', actorId: 'supervisor-cskv-01', displayName: 'Chỉ huy Công an phường Xuân Hương', actorType: 'supervisor' },
  ];
  for (const { username, actorId, displayName, actorType } of accounts) {
    const exists = await client.query('SELECT 1 FROM officer_accounts WHERE username_normalized = $1', [username]);
    if (exists.rowCount) continue;

    const password = `DfL!${randomBytes(15).toString('base64url')}7`;
    const passwordHash = await hashPassword(password);
    await client.query(
      `INSERT INTO workflow_actors (id, actor_type, display_name, locality_id, active, metadata)
       VALUES ($1, $5, $2, $3, true, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET locality_id = EXCLUDED.locality_id, active = true, updated_at = now()`,
      [actorId, displayName, localityId, JSON.stringify({ accountSource: 'local_account', shift: 'day' }), actorType],
    );
    await client.query(
      `INSERT INTO officer_accounts (actor_id, username, username_normalized, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [actorId, username, username, passwordHash],
    );
    created.push({ username, password, displayName });
  }
  const body = [
    'Tài khoản cán bộ DataForLife',
    `Tạo lúc: ${new Date().toISOString()}`,
    'Phạm vi: địa bàn thí điểm Xuân Hương - Đà Lạt (mã 24781)',
    '',
    ...created.flatMap((account) => [
      `${account.displayName}`,
      `Tên đăng nhập: ${account.username}`,
      `Mật khẩu: ${account.password}`,
      '',
    ]),
  ].join('\n');
  writeFileSync(outputPath, body, { encoding: 'utf8', mode: 0o600, flag: 'w' });
  await client.query('COMMIT');
  inTransaction = false;
} catch (error) {
  if (inTransaction) await client.query('ROLLBACK');
  unlinkSync(outputPath);
  throw error;
} finally {
  if (connected) await client.end();
}

console.log(`Đã tạo ${created.length} tài khoản; thông tin đăng nhập được lưu tại ${outputPath}.`);
