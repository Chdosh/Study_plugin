import { describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from './context-builder';
import type { LearningRuntimeSnapshot } from '../../shared/types';

vi.mock('./windows-foreground', () => ({
  getForegroundWindowInfo: vi.fn().mockResolvedValue(null)
}));

function createTestSnapshot(overrides: Partial<LearningRuntimeSnapshot> = {}): LearningRuntimeSnapshot {
  return {
    goal: { id: 'g1', title: '学 React', description: '基础扎实，未接触框架', status: 'active', sourceImportId: null, priority: 3, dueDate: null, createdAt: '', updatedAt: '' },
    dailyGuide: null,
    dailyGuideTask: null,
    dailyGuideAction: null,
    roadmapStage: null,
    questionThread: null,
    questionMessages: [],
    latestSubmission: null,
    latestEvaluation: null,
    latestDecision: null,
    pendingAdjustment: null,
    state: { id: 'default', activeGoalId: 'g1', activeStageId: null, activeDailyTaskId: null, activeStepId: null, activeQuestionThreadId: null, sessionStatus: 'idle' as const, updatedAt: '' },
    ...overrides
  };
}

function makeTask(overrides: Partial<{ title: string; evaluationMode: string; status: string }> = {}) {
  return {
    id: 't1', guideId: 'g1', roadmapStageId: null, legacyPlanBlockId: null,
    title: overrides.title ?? 'Task', objective: '', scope: '',
    estimatedMinutes: { min: 30, target: 45, max: 60 }, actions: [],
    deliverable: '', doneWhen: [], quickHint: '',
    evaluationMode: (overrides.evaluationMode ?? 'ai') as 'ai' | 'local',
    submissionPolicy: 'once_after_task' as const, carryoverAllowed: true,
    status: (overrides.status ?? 'active') as 'active' | 'planned' | 'done' | 'skipped' | 'deferred',
    progressPercent: 0, completedActions: [], remainingActions: [],
    currentAction: null, nextStartPoint: null, totalElapsedMinutes: 0, position: 0,
    createdAt: '', updatedAt: ''
  };
}

function createMockStore(snapshot: LearningRuntimeSnapshot) {
  return {
    getLearningRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot)
  };
}

describe('ContextBuilder arbitration', () => {
  it('detects conflict when goal says 基础扎实 but evaluation failed', async () => {
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'failed', mastery: 30, evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '未通过', recommendedAction: 'remediate', decision: 'stay', aiReviewId: null, createdAt: new Date().toISOString() }
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.context.conflicts).toBeDefined();
    expect((ctx.context.conflicts as Array<{ field: string }>).length).toBeGreaterThan(0);
    expect((ctx.context.conflicts as Array<{ field: string }>)[0].field).toBe('currentLevel');
    expect(ctx.context.arbitratedContext).toBeDefined();
    expect((ctx.context.arbitratedContext as { rules: Array<{ priority: string }> }).rules.length).toBeGreaterThan(0);
  });

  it('no arbitration output when no conflicts', async () => {
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'passed', mastery: 90, evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '通过', recommendedAction: 'advance', decision: 'advance', aiReviewId: null, createdAt: new Date().toISOString() }
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.context.conflicts).toBeUndefined();
    expect(ctx.context.arbitratedContext).toBeUndefined();
  });

  it('marks stale fields with contextMeta status', async () => {
    const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'passed', mastery: 90, evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '通过', recommendedAction: 'advance', decision: 'advance', aiReviewId: null, createdAt: staleDate }
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.contextMeta).toBeDefined();
    expect(ctx.contextMeta?.latestEvaluation?.status).toBe('stale');
  });

  it('arbitrates single AI judgment cannot permanently mark mastery', async () => {
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'passed', mastery: 60, evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '通过', recommendedAction: 'advance', decision: 'advance', aiReviewId: null, createdAt: new Date().toISOString() },
      dailyGuideTask: makeTask()
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.context.arbitratedContext).toBeDefined();
    const avoid = (ctx.context.arbitratedContext as { avoidAssuming: string[] }).avoidAssuming;
    expect(avoid).toContain('用户已完全掌握该知识点');
  });
});
