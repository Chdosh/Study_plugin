import { describe, expect, it, vi } from 'vitest';
import type { LearningRuntimeSnapshot, StudySession } from '../../../shared/types';
import { LearningRuntimeModule, type RuntimeStore } from './runtime';

describe('LearningRuntimeModule', () => {
  it('通过统一 Interface 执行 Action 命令并返回最新快照', async () => {
    const expected = snapshot('action-2');
    const store = createStore({
      completeCurrentAction: vi.fn().mockResolvedValue(expected)
    });
    const runtime = new LearningRuntimeModule(store);

    const result = await runtime.dispatch({ type: 'completeCurrentAction' });

    expect(result).toBe(expected);
    expect(store.completeCurrentAction).toHaveBeenCalledOnce();
  });

  it('结束本次学习时暂停持久化 active Session 并保留学习快照', async () => {
    const activeSession = session('session-1', 'active');
    const expected = snapshot('action-1');
    const store = createStore({
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      pauseSession: vi.fn().mockResolvedValue({ ...activeSession, status: 'paused' }),
      getSnapshot: vi.fn().mockResolvedValue(expected)
    });
    const runtime = new LearningRuntimeModule(store);

    const result = await runtime.dispatch({ type: 'endCurrentSession' });

    expect(store.pauseSession).toHaveBeenCalledWith(activeSession.id);
    expect(result).toBe(expected);
  });
});

function createStore(overrides: Partial<RuntimeStore> = {}): RuntimeStore {
  const current = snapshot(null);
  const defaultSession = session('session-default', 'paused');
  return {
    getSnapshot: vi.fn().mockResolvedValue(current),
    startSession: vi.fn().mockResolvedValue(defaultSession),
    pauseSession: vi.fn().mockResolvedValue(defaultSession),
    completeSession: vi.fn().mockResolvedValue({ ...defaultSession, status: 'completed' }),
    listSessions: vi.fn().mockResolvedValue([]),
    completeCurrentAction: vi.fn().mockResolvedValue(current),
    skipCurrentAction: vi.fn().mockResolvedValue(current),
    skipCurrentTask: vi.fn().mockResolvedValue(current),
    ...overrides
  };
}

function snapshot(activeStepId: string | null): LearningRuntimeSnapshot {
  return {
    state: {
      id: 'default',
      activeGoalId: null,
      activeStageId: null,
      activeDailyTaskId: activeStepId ? 'task-1' : null,
      activeStepId,
      activeQuestionThreadId: null,
      sessionStatus: activeStepId ? 'active' : 'idle',
      updatedAt: '2026-07-11T00:00:00.000Z'
    },
    goal: null,
    dailyGuide: null,
    dailyGuideTask: null,
    dailyGuideAction: null,
    roadmapStage: null,
    stageConflict: null,
    questionThread: null,
    questionMessages: [],
    latestSubmission: null,
    latestEvaluation: null,
    latestDecision: null,
    pendingAdjustment: null
  };
}

function session(id: string, status: StudySession['status']): StudySession {
  return {
    id,
    taskId: 'task-1',
    taskItemsId: null,
    startedAt: '2026-07-11T00:00:00.000Z',
    endedAt: status === 'active' ? null : '2026-07-11T00:10:00.000Z',
    durationMinutes: status === 'active' ? null : 10,
    status,
    focusScore: null,
    notes: null
  };
}
