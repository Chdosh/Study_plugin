import type { Id, LearningRuntimeSnapshot, StudySession } from '../../../shared/types';

export interface RuntimeStore {
  getSnapshot(): Promise<LearningRuntimeSnapshot>;
  startSession(taskId: Id): Promise<StudySession>;
  pauseSession(sessionId: Id): Promise<StudySession>;
  completeSession(sessionId: Id): Promise<StudySession>;
  listSessions(): Promise<StudySession[]>;
  completeCurrentAction(): Promise<LearningRuntimeSnapshot>;
  skipCurrentAction(): Promise<LearningRuntimeSnapshot>;
  skipCurrentTask(): Promise<LearningRuntimeSnapshot>;
}

export type RuntimeCommand =
  | { type: 'completeCurrentAction' }
  | { type: 'skipCurrentAction' }
  | { type: 'skipCurrentTask' }
  | { type: 'endCurrentSession' };

export class LearningRuntimeModule {
  constructor(private readonly store: RuntimeStore) {}

  getSnapshot(): Promise<LearningRuntimeSnapshot> {
    return this.store.getSnapshot();
  }

  startSession(taskId: Id): Promise<StudySession> {
    return this.store.startSession(taskId);
  }

  pauseSession(sessionId: Id): Promise<StudySession> {
    return this.store.pauseSession(sessionId);
  }

  completeSession(sessionId: Id): Promise<StudySession> {
    return this.store.completeSession(sessionId);
  }

  async dispatch(command: RuntimeCommand): Promise<LearningRuntimeSnapshot> {
    switch (command.type) {
      case 'completeCurrentAction':
        return this.store.completeCurrentAction();
      case 'skipCurrentAction':
        return this.store.skipCurrentAction();
      case 'skipCurrentTask':
        return this.store.skipCurrentTask();
      case 'endCurrentSession': {
        const activeSession = (await this.store.listSessions()).find((session) => session.status === 'active');
        if (activeSession) {
          await this.store.pauseSession(activeSession.id);
        }
        return this.store.getSnapshot();
      }
    }
  }
}
