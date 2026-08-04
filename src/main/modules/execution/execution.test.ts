import { describe, expect, it, vi } from 'vitest';
import type { LearningRuntimeSnapshot } from '../../../shared/types';
import type { StudyStore } from '../../services/store';
import { LearningExecutionModule } from './execution';

function actionSnapshot(
  sessionStatus: 'idle' | 'active' | 'paused',
  actionId: string
): LearningRuntimeSnapshot {
  return {
    state: { sessionStatus },
    dailyGuideTask: {
      id: 'task-1',
      status: 'active',
      actions: [{ id: actionId, status: 'planned' }]
    },
    dailyGuideAction: { id: actionId, status: 'planned' },
    latestSubmission: null,
    latestEvaluation: null,
    latestDecision: null
  } as LearningRuntimeSnapshot;
}

describe('LearningExecutionModule', () => {
  it('returns an already confirmed Guide without repeating the state transition', async () => {
    const guide = { id: 'guide-1', status: 'confirmed' };
    const store = {
      getDailyGuideById: vi.fn().mockResolvedValue(guide),
      confirmLearningGuide: vi.fn()
    } as unknown as StudyStore;
    const execution = new LearningExecutionModule(store);

    await expect(execution.confirmGuide('guide-1')).resolves.toBe(guide);
    expect(store.confirmLearningGuide).not.toHaveBeenCalled();
  });

  it('rejects Action completion when no active Session owns the flow', async () => {
    const store = {
      getLearningRuntimeSnapshot: vi.fn().mockResolvedValue(actionSnapshot('idle', 'action-1')),
      completeCurrentAction: vi.fn()
    } as unknown as StudyStore;
    const execution = new LearningExecutionModule(store);

    await expect(execution.completeAction('action-1')).rejects.toThrow('当前步骤不可完成');
    expect(store.completeCurrentAction).not.toHaveBeenCalled();
  });

  it('completes only the current Action in an active Session', async () => {
    const after = actionSnapshot('active', 'action-2');
    const store = {
      getLearningRuntimeSnapshot: vi.fn().mockResolvedValue(actionSnapshot('active', 'action-1')),
      completeCurrentAction: vi.fn().mockResolvedValue(after)
    } as unknown as StudyStore;
    const execution = new LearningExecutionModule(store);

    await expect(execution.completeAction('action-1')).resolves.toBe(after);
    expect(store.completeCurrentAction).toHaveBeenCalledWith('action-1', undefined);

    await expect(execution.completeAction('action-1', '完成了一个可运行函数')).resolves.toBe(after);
    expect(store.completeCurrentAction).toHaveBeenCalledWith('action-1', '完成了一个可运行函数');
  });

  it('returns the active Session from the resolved learning context', async () => {
    const session = { id: 'session-1', status: 'paused' };
    const store = {
      getCurrentLearningContext: vi.fn().mockResolvedValue({ session })
    } as unknown as StudyStore;
    const execution = new LearningExecutionModule(store);

    await expect(execution.getActiveSession()).resolves.toBe(session);
  });

  it('returns null when there is no active Session', async () => {
    const store = {
      getCurrentLearningContext: vi.fn().mockResolvedValue({ session: null })
    } as unknown as StudyStore;
    const execution = new LearningExecutionModule(store);

    await expect(execution.getActiveSession()).resolves.toBeNull();
  });
});
