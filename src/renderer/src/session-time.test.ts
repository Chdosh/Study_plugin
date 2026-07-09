import { describe, expect, it } from 'vitest';
import { getSessionElapsedSeconds } from './session-time';

describe('session timer', () => {
  it('computes active and paused session elapsed seconds from the same formula', () => {
    expect(
      getSessionElapsedSeconds(
        {
          status: 'active',
          startedAt: '2026-06-29T10:00:00.000Z',
          durationMinutes: 2
        },
        new Date('2026-06-29T10:00:30.000Z').getTime()
      )
    ).toBe(150);

    expect(
      getSessionElapsedSeconds(
        {
          status: 'paused',
          startedAt: '2026-06-29T10:00:00.000Z',
          durationMinutes: 2
        },
        new Date('2026-06-29T10:10:30.000Z').getTime()
      )
    ).toBe(120);
  });
});
