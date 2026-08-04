import { describe, expect, it, vi } from 'vitest';
import { ContextBuilder, estimateContextTokens, OPERATION_BUDGET_TOKENS } from './context-builder';
import type { LearningRuntimeSnapshot } from '../../shared/types';

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
    submissionAttempts: [],
    pendingAdjustment: null,
    state: { id: 'default', activeGoalId: 'g1', activeStageId: null, activeDailyTaskId: null, activeStepId: null, activeQuestionThreadId: null, sessionStatus: 'idle' as const, updatedAt: '' },
    ...overrides
  };
}

function makeTask(overrides: Partial<{ title: string; evaluationMode: string; status: string }> = {}) {
  return {
    id: 't1', guideId: 'g1', roadmapStageId: null,
    title: overrides.title ?? 'Task', objective: '', scope: '',
    estimatedMinutes: { min: 30, target: 45, max: 60 }, actions: [],
    deliverable: '', doneWhen: [], quickHint: '',
    evaluationMode: (overrides.evaluationMode ?? 'ai') as 'ai' | 'local',
    closureKind: null, closureReason: null,
    status: (overrides.status ?? 'active') as 'active' | 'planned' | 'deferred' | 'closed',
    nextStartPoint: null, position: 0,
    createdAt: '', updatedAt: ''
  };
}

function createMockStore(snapshot: LearningRuntimeSnapshot) {
  return {
    getLearningRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
    listFactsForGoal: vi.fn().mockResolvedValue([]),
    getEvaluationsForTask: vi.fn().mockResolvedValue([]),
    getKnowledgeContextForGoal: vi.fn().mockResolvedValue({
      knowledgeItems: [],
      reviewKnowledgeItems: []
    })
  };
}

describe('ContextBuilder arbitration', () => {
  it('injects only confirmed learner facts into model context', async () => {
    const snapshot = createTestSnapshot();
    const store = createMockStore(snapshot);
    store.listFactsForGoal.mockResolvedValue([
      { id: 'f1', goalId: 'g1', scope: 'goal', key: 'os', value: 'Windows', source: 'confirmed', confidence: 1, createdAt: '', updatedAt: '' },
      { id: 'f2', goalId: 'g1', scope: 'goal', key: 'provider', value: 'OpenAI-compatible', source: 'inferred', confidence: 0.8, createdAt: '', updatedAt: '' }
    ]);

    const ctx = await new ContextBuilder(store as never).build('teach_step');

    expect(ctx.context.learnerFacts).toEqual([{ key: 'os', value: 'Windows', scope: 'goal' }]);
    expect(ctx.contextSourceIds).toContain('f1');
    expect(ctx.contextMeta?.learnerFacts).toEqual(expect.objectContaining({ status: 'current', sourceId: 'f1' }));
  });

  it('deterministically prefers a confirmed goal fact over a conflicting global fact', async () => {
    const snapshot = createTestSnapshot();
    const store = createMockStore(snapshot);
    store.listFactsForGoal.mockResolvedValue([
      { id: 'global-os', goalId: 'g1', scope: 'global', key: 'os', value: 'Linux', source: 'confirmed', confidence: 1, createdAt: '', updatedAt: '2026-07-12T00:00:00.000Z' },
      { id: 'goal-os', goalId: 'g1', scope: 'goal', key: 'os', value: 'Windows', source: 'confirmed', confidence: 1, createdAt: '', updatedAt: '2026-07-11T00:00:00.000Z' }
    ]);

    const ctx = await new ContextBuilder(store as never).build('teach_step');

    expect(ctx.context.learnerFacts).toEqual([{ key: 'os', value: 'Windows', scope: 'goal' }]);
    expect(ctx.context.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'learnerFact:os', 采用: '当前目标=Windows' })
    ]));
  });

  it('injects a task-scoped fact only for its concrete task anchor', async () => {
    const snapshot = createTestSnapshot({ dailyGuideTask: makeTask() });
    const store = createMockStore(snapshot);
    store.listFactsForGoal.mockResolvedValue([
      { id: 'task-pref', goalId: 'g1', taskId: 't1', scope: 'task', key: 'outputStyle', value: '只给命令', source: 'confirmed', confidence: 1, createdAt: '', updatedAt: '' },
      { id: 'other-task-pref', goalId: 'g1', taskId: 't2', scope: 'task', key: 'debugMode', value: '输出日志', source: 'confirmed', confidence: 1, createdAt: '', updatedAt: '' }
    ]);

    const ctx = await new ContextBuilder(store as never).build('teach_step');

    expect(ctx.context.learnerFacts).toEqual([{ key: 'outputStyle', value: '只给命令', scope: 'task' }]);
  });

  it('evaluate_submission 上下文包含当前 Task 各已完成步骤的成果', async () => {
    const snapshot = createTestSnapshot({ dailyGuideTask: makeTask() });
    const store = createMockStore(snapshot);

    const ctx = await new ContextBuilder(store as never).build('evaluate_submission', {
      submission: '最终总结与验证证据',
      stepResults: [
        { title: '了解 RAG 检索流程', result: '口述了检索、重排、生成的完整链路' },
        { title: '向量库选型', result: '对比了 FAISS 与 pgvector' }
      ]
    });

    expect(ctx.context.stepResults).toEqual([
      { title: '了解 RAG 检索流程', result: '口述了检索、重排、生成的完整链路' },
      { title: '向量库选型', result: '对比了 FAISS 与 pgvector' }
    ]);
    expect(ctx.context.submission).toBe('最终总结与验证证据');
  });

  it('evaluate_submission 没有步骤成果时不注入该字段', async () => {
    const snapshot = createTestSnapshot({ dailyGuideTask: makeTask() });
    const store = createMockStore(snapshot);

    const ctx = await new ContextBuilder(store as never).build('evaluate_submission', {
      submission: '唯一一次提交'
    });

    expect(ctx.context.stepResults).toBeUndefined();
    expect(ctx.context.submission).toBe('唯一一次提交');
  });

  it('injects user corrections and recurring weaknesses into the next Learning Turn', async () => {
    const snapshot = createTestSnapshot({ dailyGuideTask: makeTask() });
    const store = createMockStore(snapshot);
    store.getKnowledgeContextForGoal.mockResolvedValue({
      knowledgeItems: [
        {
          id: 'weakness', goalId: 'g1', key: '泛型约束', summary: '泛型约束连续出错',
          detail: null, sourceType: 'weakness', sourceId: 's1', occurrenceCount: 3,
          lastSeenAt: '2026-07-24T09:00:00.000Z', status: 'active',
          createdAt: '', updatedAt: ''
        },
        {
          id: 'correction', goalId: 'g1', key: '用户纠正', summary: '用户已掌握联合类型',
          detail: '不要再按零基础讲解', sourceType: 'correction', sourceId: 'e1',
          occurrenceCount: 1, lastSeenAt: '2026-07-24T10:00:00.000Z', status: 'active',
          createdAt: '', updatedAt: ''
        }
      ],
      reviewKnowledgeItems: []
    });

    const ctx = await new ContextBuilder(store as never).build('teach_step');

    expect(ctx.context.knowledgePriorities).toEqual([
      expect.objectContaining({
        summary: '用户已掌握联合类型',
        reason: '用户纠正，优先于冲突的 AI 判断'
      }),
      expect.objectContaining({
        summary: '泛型约束连续出错',
        reason: '多次出现，需要在当前教学中再次验证'
      })
    ]);
    expect(ctx.contextSourceIds).toEqual(expect.arrayContaining(['correction', 'weakness']));
    expect(ctx.contextMeta?.knowledgePriorities?.sourceId).toBe('correction');
  });

  it('keeps an explicitly confirmed current level above a single conflicting evaluation', async () => {
    const evaluation = { id: 'e1', submissionId: 's1', stepId: null, result: 'failed' as const, evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '未通过', recommendedAction: 'remediate' as const, decision: 'stay' as const, source: 'ai' as const, supersedesEvaluationId: null, correctionReason: null, aiReviewId: null, createdAt: new Date().toISOString() };
    const snapshot = createTestSnapshot({ latestEvaluation: evaluation, dailyGuideTask: makeTask() });
    const store = createMockStore(snapshot);
    store.listFactsForGoal.mockResolvedValue([
      { id: 'level', goalId: 'g1', scope: 'goal', key: 'currentLevel', value: '有编程基础', source: 'confirmed', confidence: 1, createdAt: '', updatedAt: '' }
    ]);
    store.getEvaluationsForTask.mockResolvedValue([evaluation]);

    const ctx = await new ContextBuilder(store as never).build('generate_daily_guide');

    expect(ctx.context.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'currentLevel', 采用: '用户确认事实：有编程基础' })
    ]));
    expect((ctx.context.arbitratedContext as { rules: Array<{ priority: string }> }).rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ priority: '用户明确确认 > 实际提交证据 > AI 推断' })
    ]));
  });

  it('uses repeated evaluations as stronger evidence than an old unconfirmed description', async () => {
    const snapshot = createTestSnapshot({ dailyGuideTask: makeTask(), latestEvaluation: null });
    const store = createMockStore(snapshot);
    store.getEvaluationsForTask.mockResolvedValue([1, 2, 3].map((index) => ({
      id: `e${index}`, submissionId: `s${index}`, stepId: null, result: 'partial',
      evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '仍需练习',
      recommendedAction: 'remediate', decision: 'stay', source: 'ai', supersedesEvaluationId: null,
      correctionReason: null, aiReviewId: null, createdAt: `2026-07-1${index}T00:00:00.000Z`
    })));

    const ctx = await new ContextBuilder(store as never).build('generate_daily_guide');

    expect((ctx.context.arbitratedContext as { rules: Array<{ priority: string }> }).rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ priority: '连续实际评价 > 旧目标描述 > 单次 AI 判断' })
    ]));
  });

  it('applies the hard context budget after facts and extra fields are added', async () => {
    const snapshot = createTestSnapshot();
    const store = createMockStore(snapshot);
    store.listFactsForGoal.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({
      id: `f${index}`, goalId: 'g1', scope: 'goal', key: `fact-${index}`, value: 'x'.repeat(500), source: 'confirmed', confidence: 1, createdAt: '', updatedAt: ''
    })));

    const ctx = await new ContextBuilder(store as never).build('answer_step_question', { question: 'q'.repeat(20_000), ignoredSecret: 'must-not-pass' });

    expect(estimateContextTokens(ctx.context)).toBeLessThanOrEqual(OPERATION_BUDGET_TOKENS);
    expect(ctx.context).not.toHaveProperty('ignoredSecret');
  });

  it('detects conflict when goal says 基础扎实 but evaluation failed', async () => {
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'failed', evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '未通过', recommendedAction: 'remediate', decision: 'stay', source: 'ai', supersedesEvaluationId: null, correctionReason: null, aiReviewId: null, createdAt: new Date().toISOString() }
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
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'passed', evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '通过', recommendedAction: 'advance', decision: 'advance', source: 'ai', supersedesEvaluationId: null, correctionReason: null, aiReviewId: null, createdAt: new Date().toISOString() }
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.context.conflicts).toBeUndefined();
    expect(ctx.context.arbitratedContext).toBeUndefined();
  });

  it('marks stale fields with contextMeta status', async () => {
    const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'passed', evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '通过', recommendedAction: 'advance', decision: 'advance', source: 'ai', supersedesEvaluationId: null, correctionReason: null, aiReviewId: null, createdAt: staleDate }
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.contextMeta).toBeDefined();
    expect(ctx.contextMeta?.latestEvaluation?.status).toBe('stale');
  });

  it('arbitrates single AI judgment cannot permanently mark mastery', async () => {
    const snapshot = createTestSnapshot({
      latestEvaluation: { id: 'e1', submissionId: 's1', stepId: null, result: 'passed', evidence: [], correctParts: [], misconceptions: [], missingRequirements: [], feedback: '通过', recommendedAction: 'advance', decision: 'advance', source: 'ai', supersedesEvaluationId: null, correctionReason: null, aiReviewId: null, createdAt: new Date().toISOString() },
      dailyGuideTask: makeTask()
    });
    const builder = new ContextBuilder(createMockStore(snapshot) as never);
    const ctx = await builder.build('generate_daily_plan');
    expect(ctx.context.arbitratedContext).toBeDefined();
    const avoid = (ctx.context.arbitratedContext as { avoidAssuming: string[] }).avoidAssuming;
    expect(avoid).toContain('用户已完全掌握该知识点');
  });
});
