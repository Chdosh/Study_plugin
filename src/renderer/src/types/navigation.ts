export type ViewKey = 'overview' | 'study' | 'records' | 'settings';

export type StudyViewTarget =
  | { kind: 'current' }
  | { kind: 'review'; taskId: string; actionId: string };
