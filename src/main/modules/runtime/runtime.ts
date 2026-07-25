import type { CloseTaskInput, Id, LearningRuntimeSnapshot, StudySession } from '../../../shared/types';

export interface RuntimeStore {
  getSnapshot(): Promise<LearningRuntimeSnapshot>;
  startSession(taskId: Id): Promise<StudySession>;
  pauseSession(sessionId: Id): Promise<StudySession>;
  completeSession(sessionId: Id): Promise<StudySession>;
  listSessions(): Promise<StudySession[]>;
  completeCurrentAction(): Promise<LearningRuntimeSnapshot>;
  skipCurrentAction(): Promise<LearningRuntimeSnapshot>;
  closeTask(
    taskId: Id,
    closureKind: CloseTaskInput['closureKind'],
    closureReason?: string,
    nextStartPoint?: string
  ): Promise<void>;
}

export type RuntimeCommand =
  | { type: 'completeCurrentAction' }
  | { type: 'skipCurrentAction' }
  | { type: 'closeCurrentTask'; input: CloseTaskInput }
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
      case 'closeCurrentTask': {
        const current = await this.store.getSnapshot();
        if (current.dailyGuideTask?.id !== command.input.taskId) {
          throw new Error('当前 Task 已经变化，请确认最新状态后再收口。');
        }
        await this.store.closeTask(
          command.input.taskId,
          command.input.closureKind,
          command.input.closureReason,
          command.input.nextStartPoint
        );
        return this.store.getSnapshot();
      }
      case 'endCurrentSession': {
        const unfinished = (await this.store.listSessions())
          .find((session) => session.status === 'active' || session.status === 'paused');
        if (unfinished) {
          await this.store.completeSession(unfinished.id);
        }
        return this.store.getSnapshot();
      }
    }
  }
}
