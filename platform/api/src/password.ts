import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const KEY_LENGTH = 64;
const FORMAT = 'scrypt-v1';
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

/** Số phép băm chạy cùng lúc và số phép chờ tối đa: chặn kẻ tấn công dồn CPU của máy chủ bằng hàng loạt lần đăng nhập. */
const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
const maxConcurrentHashes = () => envNumber('API_HASH_CONCURRENCY', 4);
const maxQueuedHashes = () => envNumber('API_HASH_QUEUE', 300);
let runningHashes = 0;
const queuedHashes: Array<() => void> = [];

export class PasswordBusyError extends Error {
  readonly code = 'PASSWORD_BUSY';
  constructor() { super('Hệ thống đang xử lý quá nhiều đăng nhập.'); }
}

async function acquireHashSlot(): Promise<void> {
  if (runningHashes < maxConcurrentHashes()) { runningHashes += 1; return; }
  if (queuedHashes.length >= maxQueuedHashes()) throw new PasswordBusyError();
  await new Promise<void>((resolve) => queuedHashes.push(resolve));
}

function releaseHashSlot(): void {
  const next = queuedHashes.shift();
  if (next) next(); else runningHashes -= 1;
}

async function derive(password: string, salt: Buffer, keyLength: number, cost: number, blockSize: number, parallelization: number): Promise<Buffer> {
  await acquireHashSlot();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(password, salt, keyLength, {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    releaseHashSlot();
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH, COST, BLOCK_SIZE, PARALLELIZATION);
  return `${FORMAT}$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [format, rawCost, rawBlockSize, rawParallelization, encodedSalt, encodedKey, extra] = encodedHash.split('$');
  if (format !== FORMAT || !rawCost || !rawBlockSize || !rawParallelization || !encodedSalt || !encodedKey || extra) return false;
  try {
    const cost = Number(rawCost);
    const blockSize = Number(rawBlockSize);
    const parallelization = Number(rawParallelization);
    if (cost !== COST || blockSize !== BLOCK_SIZE || parallelization !== PARALLELIZATION) return false;
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expected = Buffer.from(encodedKey, 'base64url');
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt, expected.length, cost, blockSize, parallelization);
    return timingSafeEqual(actual, expected);
  } catch (error) {
    if (error instanceof PasswordBusyError) throw error; // quá tải ≠ sai mật khẩu: không được tính là đăng nhập sai
    return false;
  }
}
