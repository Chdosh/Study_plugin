import type { StudySession } from '../../../shared/types';

export interface LocalSettlement {
  session: StudySession;
  elapsedSeconds: number;
  notes: string;
}

