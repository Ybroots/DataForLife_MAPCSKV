import { describe, expect, it } from 'vitest';
import { areaCodeFromSelect, isValidOfficerPassword, isValidOfficerUsername } from '../src/officer-accounts';

describe('officer account rules (khớp máy chủ)', () => {
  it('accepts lowercase letters, digits, dot, underscore and dash, 3–100 characters', () => {
    for (const name of ['canbo01', 'thanh.p1', 'cao_duc-thanh', 'abc', 'a'.repeat(100)]) expect(isValidOfficerUsername(name), name).toBe(true);
  });

  it('rejects uppercase, accents, spaces, and wrong lengths', () => {
    for (const name of ['ab', 'Canbo', 'cán.bộ', 'can bo', 'a'.repeat(101), '', '   ']) expect(isValidOfficerUsername(name), name).toBe(false);
  });

  it('requires at least 8 characters for a password', () => {
    expect(isValidOfficerPassword('1234567')).toBe(false);
    expect(isValidOfficerPassword('12345678')).toBe(true);
  });

  it('maps the empty select value to "no area"', () => {
    expect(areaCodeFromSelect('')).toBeNull();
    expect(areaCodeFromSelect('XH-P1')).toBe('XH-P1');
  });
});
