import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface CitizenCredential {
  username: string;
  password: string;
  citizenId: string;
  displayName: string;
}

interface CitizenSessionPayload {
  citizenId: string;
  expiresAt: number;
  nonce: string;
}

const COOKIE_NAME = 'cskv_citizen_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function authenticateCitizen(credentials: readonly CitizenCredential[], username: string, password: string): CitizenCredential | null {
  const normalized = username.trim().toLocaleLowerCase('vi-VN');
  const credential = credentials.find((candidate) => candidate.username.toLocaleLowerCase('vi-VN') === normalized);
  return credential && safeEqual(password, credential.password) ? credential : null;
}

export function createCitizenSession(citizenId: string, secret: string, now = Date.now()): string {
  const payload: CitizenSessionPayload = { citizenId, expiresAt: now + SESSION_TTL_SECONDS * 1_000, nonce: randomBytes(16).toString('base64url') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyCitizenSession(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<CitizenSessionPayload>;
    if (typeof payload.citizenId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(payload.citizenId)
      || typeof payload.expiresAt !== 'number' || payload.expiresAt <= now || typeof payload.nonce !== 'string') return null;
    return payload.citizenId;
  } catch {
    return null;
  }
}

export function readCitizenSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function citizenSessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearCitizenSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
