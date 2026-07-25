import { describe, expect, it, vi } from 'vitest';
import { PlanningModule, type PlanningStore, type PrepareCurrentLearningUnitDeps } from './planning';

function fixture(overrides: Partial<PlanningStore> = {}) {
  const goal = { id: 'goal-1' } as any;
  const day = {
    id: 'day-1', roadmapStageId: 'stage-1', itemIndex: 1, title: '第一天', sessionStatus: 'pending', date: null
  } as any;
  const store = {
    getActiveGuide: vi.fn().mockResolvedValue({ goal, roadmap: [{ id: 'stage-1', status: 'active' }], shortPlan: [day], guide: null }),
    getUsedNearTermPlanItemIds: vi.fn().mockResolvedValue(new Set<string>()),
    activateNearTermPlanItem: vi.fn().mockResolvedValue(day),
    getPreviousCompletedLearningDayContext: vi.fn().mockResolvedValue(null),
    getGoalBriefForGoal: vi.fn().mockResolvedValue({}),
    getPromptProfile: vi.fn().mockResolvedValue({ id: 'profile-1', activeVersionId: 'version-1' }),
    getKnowledgeContextForGoal: vi.fn().mockResolvedValue({ knowledgeItems: [], reviewKnowledgeItems: [] }),
    saveDailyGuideWithTransaction: vi.fn().mockResolvedValue({ guide: { id: 'guide-1' } }),
    ensureDraftDailyGuide: vi.fn().mockResolvedValue({ id: 'guide-draft', sessionStatus: 'draft', tasks: [] }),
    buildContext: vi.fn().mockResolvedValue({ operation: 'generate_daily_guide', snapshot: {}, context: {}, contextSourceIds: [] }),
    acquireGenerationLock: vi.fn().mockResolvedValue(true),
    releaseGenerationLock: vi.fn().mockResolvedValue(undefined),
    closeCurrentSession: vi.fn().mockResolvedValue(undefined),
    getLatestReview: vi.fn().mockResolvedValue(null),
    ...overrides
  } as unknown as PlanningStore;
  const deps = {
    startAgentTurn: vi.fn().mockResolvedValue({
      runReviewId: 'run-1',
      output: { tasks: [] }
    }),
    getRuntimeSettings: vi.fn().mockResolvedValue({ dailyStudyWindows: [], deepseekModel: 'test-model' }),
    createTraceId: () => 'trace-1',
    todayIso: () => '2026-07-11'
  } as unknown as PrepareCurrentLearningUnitDeps;
  return { store, deps };
}

describe('PlanningModule', () => {
  it('没有可用计划日时返回 plan_exhausted，不调用 AI', async () => {
    const { store, deps } = fixture({
      getActiveGuide: vi.fn().mockResolvedValue({ goal: { id: 'goal-1' }, roadmap: [], shortPlan: [], guide: null })
    });

    const result = await new PlanningModule(store).prepareCurrentLearningUnit({}, deps);

    expect(result.preparationState).toBe('plan_exhausted');
    expect(deps.startAgentTurn).not.toHaveBeenCalled();
  });

  it('AI 失败时保留已激活计划日并允许后续重试', async () => {
    const { store, deps } = fixture();
    vi.mocked(deps.startAgentTurn).mockRejectedValue(new Error('模型超时'));

    const result = await new PlanningModule(store).prepareCurrentLearningUnit({}, deps);

    expect(result).toEqual({ preparationState: 'generation_failed', errorMessage: '模型超时' });
    expect(store.activateNearTermPlanItem).toHaveBeenCalledWith('day-1');
    expect(store.ensureDraftDailyGuide).toHaveBeenCalledWith(expect.objectContaining({ nearTermPlanItemId: 'day-1' }));
    expect(store.saveDailyGuideWithTransaction).not.toHaveBeenCalled();
    expect(store.releaseGenerationLock).toHaveBeenCalledWith('daily_guide:goal-1');
  });

  it('草稿创建失败时返回可重试结果且不调用工具', async () => {
    const { store, deps } = fixture({
      ensureDraftDailyGuide: vi.fn().mockRejectedValue(new Error('草稿写入失败'))
    });

    const result = await new PlanningModule(store).prepareCurrentLearningUnit({}, deps);

    expect(result).toEqual({ preparationState: 'generation_failed', errorMessage: '草稿写入失败' });
    expect(deps.startAgentTurn).not.toHaveBeenCalled();
  });

  it('运行设置读取失败时仍返回可重试结果，不依赖已加载模型信息', async () => {
    const { store, deps } = fixture();
    vi.mocked(deps.getRuntimeSettings).mockRejectedValue(new Error('设置读取失败'));

    const result = await new PlanningModule(store).prepareCurrentLearningUnit({}, deps);

    expect(result).toEqual({ preparationState: 'generation_failed', errorMessage: '设置读取失败' });
    expect(deps.startAgentTurn).not.toHaveBeenCalled();
  });

  it('AI 输出保存失败时保留草稿并返回可重试结果', async () => {
    const { store, deps } = fixture({
      saveDailyGuideWithTransaction: vi.fn().mockRejectedValue(new Error('执行稿保存失败'))
    });

    const result = await new PlanningModule(store).prepareCurrentLearningUnit({}, deps);

    expect(result).toEqual({ preparationState: 'generation_failed', errorMessage: '执行稿保存失败' });
    expect(deps.startAgentTurn).toHaveBeenCalledTimes(1);
  });

  it('同一目标的并发准备共享一次生成任务', async () => {
    const { store, deps } = fixture();
    let resolve!: (value: any) => void;
    vi.mocked(deps.startAgentTurn).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const planning = new PlanningModule(store);

    const first = planning.prepareCurrentLearningUnit({}, deps);
    await vi.waitFor(() => expect(deps.startAgentTurn).toHaveBeenCalledTimes(1));
    const second = planning.prepareCurrentLearningUnit({}, deps);
    resolve({ runReviewId: 'run-1', output: { tasks: [] } });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(deps.startAgentTurn).toHaveBeenCalledTimes(1);
    expect(store.acquireGenerationLock).toHaveBeenCalledTimes(1);
  });

  it('当前学习日仍有未完成任务时拒绝推进', async () => {
    const { store, deps } = fixture({
      getActiveGuide: vi.fn().mockResolvedValue({
        goal: { id: 'goal-1' }, roadmap: [], shortPlan: [],
        guide: { id: 'guide-1', date: '2026-07-11', sessionStatus: 'active', tasks: [{ status: 'active' }] }
      })
    });

    await expect(new PlanningModule(store).advanceLearningDay({}, {
      ...deps, generateReview: vi.fn()
    })).rejects.toThrow('还有进行中或待处理的 Task');
    expect(store.closeCurrentSession).not.toHaveBeenCalled();
  });

  it('Review 失败不会回滚已关闭学习日，并继续检查下一单元', async () => {
    const activeGuide = {
      goal: { id: 'goal-1' }, roadmap: [], shortPlan: [],
      guide: { id: 'guide-1', date: '2026-07-11', sessionStatus: 'active', tasks: [{ status: 'done' }] }
    } as any;
    const noActiveGuide = { goal: { id: 'goal-1' }, roadmap: [], shortPlan: [], guide: null } as any;
    const getActiveGuide = vi.fn().mockResolvedValueOnce(activeGuide).mockResolvedValueOnce(noActiveGuide);
    const { store, deps } = fixture({ getActiveGuide });

    const result = await new PlanningModule(store).advanceLearningDay({}, {
      ...deps, generateReview: vi.fn().mockRejectedValue(new Error('复盘模型超时'))
    });

    expect(store.closeCurrentSession).toHaveBeenCalledWith('guide-1');
    expect(result.preparationState).toBe('plan_exhausted');
    expect(result.review).toBeNull();
  });

  it('已关闭学习日复用已有 Review，不重复调用模型', async () => {
    const review = { reviewId: 'review-1', date: '2026-07-11' } as any;
    const closedGuide = {
      goal: { id: 'goal-1' }, roadmap: [], shortPlan: [],
      guide: { id: 'guide-1', date: '2026-07-11', sessionStatus: 'closed', tasks: [{ status: 'done' }] }
    } as any;
    const noActiveGuide = { goal: { id: 'goal-1' }, roadmap: [], shortPlan: [], guide: null } as any;
    const getActiveGuide = vi.fn().mockResolvedValueOnce(closedGuide).mockResolvedValueOnce(noActiveGuide);
    const { store, deps } = fixture({ getActiveGuide, getLatestReview: vi.fn().mockResolvedValue(review) });
    const generateReview = vi.fn();

    const result = await new PlanningModule(store).advanceLearningDay({}, { ...deps, generateReview });

    expect(result.review).toBe(review);
    expect(generateReview).not.toHaveBeenCalled();
  });

  it('所有 Task 已完成或放弃时都可以关闭学习单元', async () => {
    const { store } = fixture({
      getActiveGuide: vi.fn()
        .mockResolvedValueOnce({ guide: { id: 'guide-1', tasks: [{ status: 'active' }] } })
        .mockResolvedValueOnce({ guide: { id: 'guide-1', tasks: [{ status: 'done' }, { status: 'skipped' }] } })
    });
    const planning = new PlanningModule(store);

    await expect(planning.closeCompletedLearningDay()).resolves.toBe(false);
    await expect(planning.closeCompletedLearningDay()).resolves.toBe(true);
    expect(store.closeCurrentSession).toHaveBeenCalledTimes(1);
    expect(store.closeCurrentSession).toHaveBeenCalledWith('guide-1');
  });
});
