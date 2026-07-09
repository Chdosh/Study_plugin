import type { StudySession } from '../../shared/types';

export const FLOAT_DRAG_THRESHOLD_PX = 4;
export const FLOAT_DRAG_ACTIVATION_SUPPRESS_MS = 350;

interface Point {
  x: number;
  y: number;
}

type TimerSession = Pick<StudySession, 'status' | 'startedAt' | 'durationMinutes'>;

export function hasExceededDragThreshold(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > FLOAT_DRAG_THRESHOLD_PX;
}

export function shouldSuppressActivationAfterDrag(lastDragEndedAt: number | null, now: number): boolean {
  return lastDragEndedAt !== null && now - lastDragEndedAt < FLOAT_DRAG_ACTIVATION_SUPPRESS_MS;
}

export function getSessionElapsedSeconds(session: TimerSession | null | undefined, now: number = Date.now()): number {
  if (!session) return 0;

  const baseSeconds = Math.round((session.durationMinutes ?? 0) * 60);
  if (session.status === 'active') {
    const startedAt = new Date(session.startedAt).getTime();
    if (Number.isNaN(startedAt)) return baseSeconds;
    return baseSeconds + Math.max(0, Math.floor((now - startedAt) / 1000));
  }

  if (session.status === 'paused' || session.status === 'completed' || session.status === 'skipped') {
    return baseSeconds;
  }

  return 0;
}
