import type {
  DailyGuide,
  Id,
  LearningRuntimeSnapshot,
  StudySession
} from '../../../shared/types';
import { deriveLearningFlow } from '../../../shared/learning-flow';
import type { StudyStore } from '../../services/store';

export class LearningExecutionModule {
  constructor(private readonly store: StudyStore) {}

  getState(): Promise<LearningRuntimeSnapshot> {
    return this.store.getLearningRuntimeSnapshot();
  }

  async confirmGuide(guideId: Id): Promise<DailyGuide> {
    const existing = await this.store.getDailyGuideById(guideId);
    if (existing?.status === 'confirmed') {
      return existing;
    }
    return this.store.confirmLearningGuide(guideId);
  }

  selectGuide(guideId: Id): Promise<void> {
    return this.store.selectCurrentGuide(guideId);
  }

  restoreArchivedGuide(guideId: Id): Promise<LearningRuntimeSnapshot> {
    return this.store.restoreArchivedGuide(guideId);
  }

  resolveLearningUnit(guideId: Id, decision: 'restore' | 'skip'): Promise<void> {
    return this.store.resolveAmbiguousLearningUnit(guideId, decision);
  }

  startSession(taskId: Id): Promise<StudySession> {
    return this.store.startSession(taskId);
  }

  pauseSession(sessionId: Id): Promise<StudySession> {
    return this.store.pauseSession(sessionId);
  }

  endSession(sessionId: Id): Promise<StudySession> {
    return this.store.completeSession(sessionId);
  }

  async getActiveSession(): Promise<StudySession | null> {
    const context = await this.store.getCurrentLearningContext();
    return context.session;
  }

  async completeAction(actionId: Id, note?: string): Promise<LearningRuntimeSnapshot> {
    return this.advanceAction(actionId, 'done', note);
  }

  async skipAction(actionId: Id): Promise<LearningRuntimeSnapshot> {
    return this.advanceAction(actionId, 'skipped');
  }

  private async advanceAction(
    actionId: Id,
    mode: 'done' | 'skipped',
    note?: string
  ): Promise<LearningRuntimeSnapshot> {
    const flow = deriveLearningFlow(await this.store.getLearningRuntimeSnapshot());
    const canAdvance = mode === 'done' ? flow.canCompleteAction : flow.canSkipAction;
    if (!canAdvance || flow.currentActionId !== actionId) {
      throw new Error(`当前步骤不可${mode === 'done' ? '完成' : '跳过'}，请刷新学习状态后重试。`);
    }
    return mode === 'done'
      ? this.store.completeCurrentAction(actionId, note)
      : this.store.skipCurrentAction(actionId);
  }

}
