import { describe, expect, it } from 'vitest';
import { clearReportDraft, loadReportDraft, saveReportDraft } from '../src/report-draft';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    data,
  };
}
const draft = { category: 'traffic', summary: 'Xe đậu chắn lối đi', description: 'Có xe đậu chắn lối vào hẻm từ chiều qua.', locationNote: 'Hẻm 12', contactPhone: '0912345678' };

describe('report draft', () => {
  it('saves what was typed and restores it later', () => {
    const storage = memoryStorage();
    saveReportDraft(draft, storage, 1_000);
    expect(loadReportDraft(storage, 2_000)).toEqual({ ...draft, savedAt: 1_000 });
  });

  it('does not keep a blank draft and clears on request', () => {
    const storage = memoryStorage();
    saveReportDraft(draft, storage, 1_000);
    saveReportDraft({ ...draft, summary: '  ', description: '', locationNote: '', contactPhone: '' }, storage, 2_000);
    expect(storage.data.size).toBe(0);
    saveReportDraft(draft, storage, 3_000);
    clearReportDraft(storage);
    expect(loadReportDraft(storage, 4_000)).toBeNull();
  });

  it('drops drafts older than 3 days, corrupt data and oversized fields', () => {
    const day = 24 * 60 * 60_000;
    const old = memoryStorage();
    saveReportDraft(draft, old, 0);
    expect(loadReportDraft(old, 3 * day + 1)).toBeNull();
    expect(old.data.size).toBe(0);
    expect(loadReportDraft(memoryStorage({ 'cskv-report-draft-v1': '{nope' }), 1)).toBeNull();
    const big = memoryStorage({ 'cskv-report-draft-v1': JSON.stringify({ ...draft, summary: 'x'.repeat(500), savedAt: 10 }) });
    expect(loadReportDraft(big, 20)?.summary).toHaveLength(180);
  });

  it('never throws when storage is unavailable or full', () => {
    expect(loadReportDraft(null)).toBeNull();
    expect(() => saveReportDraft(draft, null)).not.toThrow();
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    expect(() => saveReportDraft(draft, full)).not.toThrow();
  });
});
