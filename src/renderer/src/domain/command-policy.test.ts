import { describe, expect, it } from 'vitest';
import { computeCommandPolicy } from './command-policy';
import type { LearningRuntimeSnapshot } from '../../../shared/types';

function makeSnapshot(overrides: Partial<LearningRuntimeSnapshot> = {}): LearningRuntimeSnapshot {
  return {
    state: {
      id: 'default',
      activeGoalId: 'goal-1',
      activeStageId: 'stage-1',
      activeDailyTaskId: 'task-1',
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle',
      updatedAt: '2026-07-11T00:00:00.000Z'
    },
    goal: { id: 'goal-1', sourceImportId: null, title: '学习目标', description: null, status: 'active', priority: 1, dueDate: null, createdAt: '', updatedAt: '' },
    dailyGuide: {
      id: 'guide-1',
      goalId: 'goal-1',
      planId: 'plan-1',
      shortPlanDayId: 'day-1',
      date: '2026-07-11',
      status: 'confirmed',
      sessionStatus: 'active',
      weekFocus: '本周重点',
      todayGoal: '今日目标',
      deliverables: [],
      boundaries: [],
      acceptanceCriteria: [],
      tomorrowActions: [],
      createdAt: '',
      confirmedAt: '',
      tasks: [
        {
          id: 'task-1',
          guideId: 'guide-1',
          roadmapStageId: 'stage-1',
          legacyPlanBlockId: null,
          title: '任务一',
          objective: '目标',
          scope: '范围',
          estimatedMinutes: { min: 20, target: 30, max: 40 },
          actions: [
            { id: 'act-1', taskId: 'task-1', title: '步骤1', instruction: '说明', checkpoint: '标准', status: 'planned', progressNote: null, completedAt: null, position: 0 },
            { id: 'act-2', taskId: 'task-1', title: '步骤2', instruction: '说明', checkpoint: '标准', status: 'planned', progressNote: null, completedAt: null, position: 1 }
          ],
          deliverable: '',
          doneWhen: [],
          quickHint: '',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: false,
          status: 'active',
          progressPercent: 0,
          completedActions: [],
          remainingActions: ['act-1', 'act-2'],
          currentAction: null,
          nextStartPoint: null,
          totalElapsedMinutes: 0,
          position: 0,
          createdAt: '',
          updatedAt: ''
        }
      ],
      blocks: []
    },
    dailyGuideTask: {
      id: 'task-1',
      guideId: 'guide-1',
      roadmapStageId: 'stage-1',
      legacyPlanBlockId: null,
      title: '任务一',
      objective: '目标',
      scope: '范围',
      estimatedMinutes: { min: 20, target: 30, max: 40 },
      actions: [],
      deliverable: '',
      doneWhen: [],
      quickHint: '',
      evaluationMode: 'ai',
      submissionPolicy: 'once_after_task',
      carryoverAllowed: false,
      status: 'active',
      progressPercent: 0,
      completedActions: [],
      remainingActions: ['act-1', 'act-2'],
      currentAction: null,
      nextStartPoint: null,
      totalElapsedMinutes: 0,
      position: 0,
      createdAt: '',
      updatedAt: ''
    },
    dailyGuideAction: { id: 'act-1', taskId: 'task-1', title: '步骤1', instruction: '说明1', checkpoint: '标准1', status: 'planned', progressNote: null, completedAt: null, position: 0 },
    roadmapStage: { id: 'stage-1', goalId: 'goal-1', title: '阶段一', objective: '', direction: '', successCriteria: '', status: 'active', position: 0, createdAt: '', updatedAt: '' },
    questionThread: null,
    questionMessages: [],
    latestSubmission: null,
    latestEvaluation: null,
    latestDecision: null,
    pendingAdjustment: null,
    ...overrides
  };
}

describe('computeCommandPolicy', () => {
  it('returns all false when snapshot is null', () => {
    const policy = computeCommandPolicy(null);
    expect(policy.canStart).toBe(false);
    expect(policy.canPause).toBe(false);
    expect(policy.canResume).toBe(false);
    expect(policy.canCompleteAction).toBe(false);
    expect(policy.sessionStatus).toBe('not_started');
  });

  it('enables start when no active session and task not done', () => {
    const snapshot = makeSnapshot({ state: { ...makeSnapshot().state, sessionStatus: 'idle' } });
    const policy = computeCommandPolicy(snapshot);
    expect(policy.canStart).toBe(true);
    expect(policy.canTerminate).toBe(false);
  });

  it('enables pause and complete action when session active', () => {
    const snapshot = makeSnapshot({ state: { ...makeSnapshot().state, sessionStatus: 'active' } });
    const policy = computeCommandPolicy(snapshot);
    expect(policy.canStart).toBe(false);
    expect(policy.canPause).toBe(true);
    expect(policy.canCompleteAction).toBe(true);
    expect(policy.canSkipAction).toBe(true);
    expect(policy.canAskQuestion).toBe(true);
    expect(policy.canTerminate).toBe(true);
    expect(policy.sessionStatus).toBe('active');
  });

  it('enables resume and terminate when session paused', () => {
    const snapshot = makeSnapshot({ state: { ...makeSnapshot().state, sessionStatus: 'paused' } });
    const policy = computeCommandPolicy(snapshot);
    expect(policy.canResume).toBe(true);
    expect(policy.canPause).toBe(false);
    expect(policy.canAskQuestion).toBe(true);
    expect(policy.canTerminate).toBe(true);
    expect(policy.sessionStatus).toBe('paused');
  });

  it('allows submit when session active and current task done, more tasks remain', () => {
    const base = makeSnapshot();
    const snapshot = makeSnapshot({
      state: { ...base.state, sessionStatus: 'active' },
      dailyGuide: {
        ...base.dailyGuide!,
        tasks: [
          { ...base.dailyGuide!.tasks[0], status: 'done' },
          {
            ...base.dailyGuide!.tasks[0],
            id: 'task-2',
            title: '任务二',
            status: 'planned'
          }
        ]
      },
      dailyGuideTask: { ...base.dailyGuideTask!, status: 'done' }
    });
    const policy = computeCommandPolicy(snapshot);
    expect(policy.canStart).toBe(false);
    expect(policy.canCompleteAction).toBe(false);
    expect(policy.canSubmit).toBe(true);
    expect(policy.sessionStatus).toBe('active');
  });

  it('disables everything when no guide', () => {
    const snapshot = makeSnapshot({ dailyGuide: null });
    const policy = computeCommandPolicy(snapshot);
    expect(policy.canStart).toBe(false);
    expect(policy.reasons.canStart).toBeTruthy();
  });

  it('disables everything when no current task', () => {
    const snapshot = makeSnapshot({ dailyGuideTask: null });
    const policy = computeCommandPolicy(snapshot);
    expect(policy.canStart).toBe(false);
    expect(policy.reasons.canStart).toBeTruthy();
  });
});
