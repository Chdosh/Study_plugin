import { describe, expect, it } from 'vitest';
import {
  FLOAT_DRAG_THRESHOLD_PX,
  getSessionElapsedSeconds,
  hasExceededDragThreshold,
  shouldSuppressActivationAfterDrag
} from './float-behavior';

describe('float window behavior', () => {
  it('treats pointer movement past the drag threshold as dragging', () => {
    expect(
      hasExceededDragThreshold({ x: 100, y: 100 }, { x: 100 + FLOAT_DRAG_THRESHOLD_PX, y: 100 })
    ).toBe(false);
    expect(
      hasExceededDragThreshold({ x: 100, y: 100 }, { x: 100 + FLOAT_DRAG_THRESHOLD_PX + 1, y: 100 })
    ).toBe(true);
  });

  it('suppresses activation immediately after dragging', () => {
    expect(shouldSuppressActivationAfterDrag(1_000, 1_100)).toBe(true);
    expect(shouldSuppressActivationAfterDrag(1_000, 1_500)).toBe(false);
    expect(shouldSuppressActivationAfterDrag(null, 1_100)).toBe(false);
  });

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
