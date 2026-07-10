import { describe, expect, it } from 'vitest';
import { localDateIso } from './date';

describe('localDateIso', () => {
  it('formats the local calendar date instead of slicing UTC', () => {
    const localMidnight = new Date(2026, 6, 11, 0, 30, 0);
    expect(localDateIso(localMidnight)).toBe('2026-07-11');
  });
});
