import type { StudySession } from '../../shared/types';

type TimerSession = Pick<StudySession, 'status' | 'startedAt' | 'durationMinutes'>;

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
