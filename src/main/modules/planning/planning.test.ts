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
    markRoadmapStageReadyForReview: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as PlanningStore;
  const deps = {
    startAgentTurn: vi.fn().mockResolvedValue({
      runReviewId: 'run-1',
      output: { tasks: [] }
    }),
    getRuntimeSettings: vi.fn().mockResolvedValue({ dailyStudyWindows: [], aiModel: 'test-model' }),
    createTraceId: () => 'trace-1',
    todayIso: () => '2026-07-11'
  } as unknown as PrepareCurrentLearningUnitDeps;
  return { store, deps };
}

describe('PlanningModule', () => {
  it('repairs an exhausted active Stage and routes to review without calling AI', async () => {
    const goal = { id: 'goal-1' } as any;
    const activeState = {
      goal,
      roadmap: [{ id: 'stage-1', status: 'active' }],
      shortPlan: [{ id: 'day-1', roadmapStageId: 'stage-1', sessionStatus: 'completed' }],
      guide: null
    } as any;
    const reviewState = {
      ...activeState,
      roadmap: [{ id: 'stage-1', status: 'ready_for_review' }]
    } as any;
    const getActiveGuide = vi.fn()
      .mockResolvedValueOnce(activeState)
      .mockResolvedValueOnce(reviewState);
    const { store, deps } = fixture({ getActiveGuide });

    const result = await new PlanningModule(store).prepareCurrentLearningUnit({ forceRetry: true }, deps);

    expect(store.markRoadmapStageReadyForReview).toHaveBeenCalledWith(goal.id);
    expect(result).toEqual({ preparationState: 'stage_review_required' });
    expect(deps.startAgentTurn).not.toHaveBeenCalled();
  });

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

  it('AI 失败留下 draft Guide 后，用户更换配置重试仍会恢复原生成流程', async () => {
    const goal = { id: 'goal-1' } as any;
    const stage = { id: 'stage-1', status: 'active' } as any;
    const item = {
      id: 'day-1',
      roadmapStageId: stage.id,
      itemIndex: 1,
      title: '第一单元',
      sessionStatus: 'active',
      date: null
    } as any;
    let draftCreated = false;
    const { store, deps } = fixture({
      getActiveGuide: vi.fn(async (activeOnly = false) => {
        if (draftCreated && activeOnly) {
          return { goal: null, roadmap: [], shortPlan: [], guide: null };
        }
        return {
          goal,
          roadmap: [stage],
          shortPlan: [item],
          guide: draftCreated
            ? {
                id: 'guide-draft',
                goalId: goal.id,
                nearTermPlanItemId: item.id,
                sessionStatus: 'draft',
                tasks: []
              }
            : null
        };
      }) as any,
      ensureDraftDailyGuide: vi.fn(async () => {
        draftCreated = true;
        return { id: 'guide-draft', sessionStatus: 'draft', tasks: [] } as any;
      })
    });
    vi.mocked(deps.startAgentTurn)
      .mockRejectedValueOnce(new Error('旧配置请求失败'))
      .mockResolvedValueOnce({
        runReviewId: 'run-2',
        output: { tasks: [] }
      } as any);
    const planning = new PlanningModule(store);

    await expect(planning.prepareCurrentLearningUnit({}, deps))
      .resolves.toEqual({
        preparationState: 'generation_failed',
        errorMessage: '旧配置请求失败'
      });

    const retried = await planning.prepareCurrentLearningUnit(
      { forceRetry: true },
      deps
    );

    expect(retried.preparationState).toBe('active');
    expect(deps.startAgentTurn).toHaveBeenCalledTimes(2);
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

});
