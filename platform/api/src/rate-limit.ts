import { randomUUID } from 'node:crypto';

/**
 * In-memory sliding window keyed by subject. Each entry has a unique key so that a retry of the
 * same request (same idempotency key) is not counted twice. State is per process and resets on
 * restart: this is a stop-gap for the single-VPS pilot; nginx limit_req is the outer layer and a
 * database-backed store is the planned replacement (see the anti-spam plan).
 */
export class AttemptWindow {
  private readonly entries = new Map<string, Map<string, number>>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  private live(subject: string): Map<string, number> {
    const now = this.clock();
    const current = this.entries.get(subject);
    if (!current) return new Map();
    for (const [key, at] of current) if (now - at >= this.windowMs) current.delete(key);
    if (current.size === 0) this.entries.delete(subject);
    return current;
  }

  has(subject: string, uniqueKey: string): boolean {
    return this.live(subject).has(uniqueKey);
  }

  /** Seconds until a slot frees up, or 0 when the subject is under its limit. */
  retryAfterSeconds(subject: string): number {
    const current = this.live(subject);
    if (current.size < this.max) return 0;
    const oldest = Math.min(...current.values());
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.clock()) / 1_000));
  }

  record(subject: string, uniqueKey: string = randomUUID()): void {
    if (this.entries.size > 10_000) {
      for (const key of [...this.entries.keys()]) this.live(key);
    }
    const current = this.entries.get(subject) ?? new Map<string, number>();
    if (!current.has(uniqueKey)) current.set(uniqueKey, this.clock());
    this.entries.set(subject, current);
  }

  clear(subject: string): void {
    this.entries.delete(subject);
  }
}

/** Failed-login throttle: per (ip, username) and per ip. A correct login clears the pair counter. */
export class LoginGuard {
  private readonly perAccount: AttemptWindow;
  private readonly perIp: AttemptWindow;

  constructor(options: { accountFailures?: number; ipFailures?: number; windowMs?: number; clock?: () => number } = {}) {
    const windowMs = options.windowMs ?? 15 * 60_000;
    this.perAccount = new AttemptWindow(options.accountFailures ?? 5, windowMs, options.clock);
    this.perIp = new AttemptWindow(options.ipFailures ?? 30, windowMs, options.clock);
  }

  private accountKey(ip: string, username: string): string {
    return `${ip}|${username.trim().toLocaleLowerCase('vi-VN')}`;
  }

  /** Returns seconds to wait, or 0 when the attempt may proceed. */
  retryAfterSeconds(ip: string, username: string): number {
    return Math.max(this.perAccount.retryAfterSeconds(this.accountKey(ip, username)), this.perIp.retryAfterSeconds(ip));
  }

  recordFailure(ip: string, username: string): void {
    this.perAccount.record(this.accountKey(ip, username));
    this.perIp.record(ip);
  }

  recordSuccess(ip: string, username: string): void {
    this.perAccount.clear(this.accountKey(ip, username));
  }
}
