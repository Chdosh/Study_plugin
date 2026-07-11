import type { Id, LearningRuntimeSnapshot, StudySession } from '../../../shared/types';
import type { StudyStore } from '../../services/store';

export type RuntimeCommand =
  | { type: 'startSession'; taskId: Id }
  | { type: 'pauseSession'; sessionId: Id }
  | { type: 'resumeSession'; sessionId: Id; taskId: Id }
  | { type: 'completeSession'; sessionId: Id }
  | { type: 'archiveSessionsByGoal'; goalId: Id };

export interface CommandResult {
  ok: boolean;
  snapshot: LearningRuntimeSnapshot;
  error?: string;
}

export interface SessionOps {
  start(taskId: Id): Promise<StudySession>;
  pause(sessionId: Id): Promise<StudySession>;
  complete(sessionId: Id): Promise<StudySession>;
}

export class LearningRuntimeModule {
  constructor(private readonly store: StudyStore) {}

  getSnapshot(): Promise<LearningRuntimeSnapshot> {
    return this.store.getLearningRuntimeSnapshot();
  }

  get session(): SessionOps {
    return {
      start: (taskId) => this.store.startSession(taskId),
      pause: (sessionId) => this.store.pauseSession(sessionId),
      complete: (sessionId) => this.store.completeSession(sessionId)
    };
  }

  async dispatch(command: RuntimeCommand): Promise<CommandResult> {
    try {
      switch (command.type) {
        case 'startSession':
          await this.store.startSession(command.taskId);
          break;
        case 'pauseSession':
          await this.store.pauseSession(command.sessionId);
          break;
        case 'resumeSession':
          await this.store.startSession(command.taskId);
          break;
        case 'completeSession':
          await this.store.completeSession(command.sessionId);
          break;
        case 'archiveSessionsByGoal':
          await this.store.archiveTodayGuides(command.goalId);
          break;
      }
      const snapshot = await this.store.getLearningRuntimeSnapshot();
      return { ok: true, snapshot };
    } catch (error) {
      const snapshot = await this.store.getLearningRuntimeSnapshot();
      return { ok: false, snapshot, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
