import type { DailyGuideAgentOutput } from '../../../shared/schemas';
import type {
  GenerateRollingPlanResult,
  Id,
  LearningGoal,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PrepareCurrentLearningDayResult,
  ReviewResult,
  RoadmapStage,
  ShortPlanDay,
  StartNextSessionResult
} from '../../../shared/types';
import type { AiCallMetrics } from '../../ai/ai-client';
import type { StudyStore } from '../../services/store';

export type PlanningStore = Pick<StudyStore,
  | 'getGoal'
  | 'getActiveGuide'
  | 'getUsedShortPlanDayIds'
  | 'activateShortPlanDay'
  | 'getPreviousCompletedLearningDayContext'
  | 'getGoalBriefForGoal'
  | 'getPromptProfile'
  | 'getKnowledgeContextForGoal'
  | 'saveAiReview'
  | 'saveDailyGuideWithTransaction'
  | 'ensureDraftDailyGuide'
  | 'acquireGenerationLock'
  | 'releaseGenerationLock'
  | 'closeCurrentSession'
  | 'getLatestReview'
  | 'findActiveOrActivateStage'
  | 'listAvailableShortPlanDaysForStage'
  | 'getRollingPlanContext'
  | 'saveRollingPlanDays'
  | 'getPlanVersionsForGoal'
  | 'createProposal'
  | 'confirmProposal'
  | 'rejectProposal'
  | 'markRoadmapStageReadyForReview'
  | 'confirmRoadmapStageCompletion'
  | 'buildContext'
>;

export interface PrepareCurrentLearningDayDeps {
  dailyGuideAgent: { run(params: any): Promise<DailyGuideAgentOutput> };
  getRuntimeSettings: () => Promise<any>;
  createTraceId: () => string;
  todayIso: () => string;
}

export interface AdvanceLearningDayDeps extends PrepareCurrentLearningDayDeps {
  generateReview: (guideId: Id) => Promise<ReviewResult>;
}

export interface GenerateRollingPlanDeps {
  shortPlanAgent: { runRolling(params: any): Promise<any> };
  dailyGuideAgent: { run(params: any): Promise<any> };
  getRuntimeSettings: () => Promise<any>;
  saveAiReview: (params: any) => Promise<string>;
  createTraceId: () => string;
  todayIso: () => string;
  onError?: (error: unknown) => void;
}

export class PlanningModule {
  private readonly generationLocks = new Map<string, Promise<PrepareCurrentLearningDayResult>>();

  constructor(private readonly store: PlanningStore) {}

  isPreparing(goalId: Id): boolean {
    return this.generationLocks.has(`daily_guide:${goalId}`);
  }

  async prepareCurrentLearningDay(
    params: { forceRetry?: boolean },
    deps: PrepareCurrentLearningDayDeps
  ): Promise<PrepareCurrentLearningDayResult> {
    const today = await this.store.getActiveGuide(true);
    if (!today.goal) return { todayState: 'needs_goal' };

    const lockKey = `daily_guide:${today.goal.id}`;
    const existingLock = this.generationLocks.get(lockKey);
    if (existingLock) return existingLock;

    if (params.forceRetry) await this.store.releaseGenerationLock(lockKey);
    if (!await this.store.acquireGenerationLock(lockKey)) return { todayState: 'generating' };

    const promise = this.doPrepareCurrentLearningDay(today.goal, today.roadmap, today.shortPlan, today.guide, deps);
    this.generationLocks.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      this.generationLocks.delete(lockKey);
      await this.store.releaseGenerationLock(lockKey).catch(() => undefined);
    }
  }

  private async doPrepareCurrentLearningDay(
    goal: LearningGoal,
    roadmap: RoadmapStage[],
    shortPlan: ShortPlanDay[],
    existingGuide: Awaited<ReturnType<PlanningStore['getActiveGuide']>>['guide'],
    deps: PrepareCurrentLearningDayDeps
  ): Promise<PrepareCurrentLearningDayResult> {
    const pendingDraft = existingGuide?.sessionStatus === 'draft' && existingGuide.tasks.length === 0;
    if (existingGuide && !pendingDraft) {
      return { todayState: existingGuide.status === 'completed' ? 'completed' : 'active' };
    }

    const usedDayIds = await this.store.getUsedShortPlanDayIds(goal.id);
    let targetDay = pendingDraft
      ? shortPlan.find((day) => day.id === existingGuide.shortPlanDayId) ?? null
      : shortPlan.find((day) => day.sessionStatus === 'active' && !usedDayIds.has(day.id)) ?? null;
    const isRetry = targetDay !== null;
    if (!targetDay) {
      targetDay = shortPlan
        .filter((day) => day.sessionStatus === 'pending' && day.date === null && !usedDayIds.has(day.id))
        .sort((a, b) => a.dayIndex - b.dayIndex)[0] ?? null;
    }
    if (!targetDay) return { todayState: 'plan_exhausted' };

    if (!isRetry && !await this.store.activateShortPlanDay(targetDay.id)) {
      return { todayState: 'generating' };
    }

    const previousDayResult = isRetry
      ? undefined
      : await this.store.getPreviousCompletedLearningDayContext(goal.id) ?? undefined;
    const [brief, profile, settings, knowledge] = await Promise.all([
      this.store.getGoalBriefForGoal(goal.id),
      this.store.getPromptProfile(),
      deps.getRuntimeSettings(),
      this.store.getKnowledgeContextForGoal(goal.id)
    ]);
    await this.store.ensureDraftDailyGuide({
      goal, date: deps.todayIso(), windows: settings.dailyStudyWindows, shortPlanDayId: targetDay.id
    });

    const traceId = deps.createTraceId();
    let metrics: AiCallMetrics | undefined;
    let contextSourceIds: string[] = [];
    let output: DailyGuideAgentOutput;
    try {
      const boundedContext = await this.store.buildContext('generate_daily_guide', {
        shortPlanDay: targetDay,
        previousDayResult,
        availableMinutes: settings.dailyStudyWindows
      });
      contextSourceIds = boundedContext.contextSourceIds;
      output = await deps.dailyGuideAgent.run({
        date: deps.todayIso(), windows: settings.dailyStudyWindows, goal, brief, roadmap, targetDay,
        previousDayResult, profile, settings, knowledgeItems: knowledge.knowledgeItems,
        reviewKnowledgeItems: knowledge.reviewKnowledgeItems, context: boundedContext.context, traceId,
        onMetrics: (value: AiCallMetrics) => { metrics = value; }
      });
      await this.store.saveAiReview({
        kind: 'daily_guide', date: deps.todayIso(), provider: 'deepseek', model: settings.deepseekModel,
        promptProfileId: profile.id, promptVersionId: profile.activeVersionId,
        inputSnapshot: { goalId: goal.id, targetDay: targetDay.title, contextSourceIds }, output,
        outputSchemaVersion: 'daily-guide.v2', status: 'success', metrics
      });
    } catch (error) {
      await this.store.saveAiReview({
        kind: 'daily_guide', date: deps.todayIso(), provider: 'deepseek', model: settings.deepseekModel,
        promptProfileId: profile.id, promptVersionId: profile.activeVersionId,
        inputSnapshot: { goalId: goal.id, targetDay: targetDay.title, contextSourceIds }, output: {},
        outputSchemaVersion: 'daily-guide.v2', status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        metrics: metrics ? { ...metrics, errorCategory: 'ai_failure' } : undefined
      });
      return { todayState: 'generation_failed', errorMessage: error instanceof Error ? error.message : String(error) };
    }

    const result = await this.store.saveDailyGuideWithTransaction({
      goal, date: deps.todayIso(), windows: settings.dailyStudyWindows,
      shortPlanDayId: targetDay.id, dailyGuide: output
    });
    return { todayState: 'active', result };
  }

  async advanceLearningDay(
    params: { goalId?: Id },
    deps: AdvanceLearningDayDeps
  ): Promise<StartNextSessionResult> {
    const today = await this.store.getActiveGuide();
    if (params.goalId && today.goal?.id !== params.goalId) {
      throw new Error('当前学习目标与请求的目标不一致，请刷新后重试。');
    }

    let review: ReviewResult | null = null;
    if (today.guide?.sessionStatus === 'active') {
      const allTasksDone = today.guide.tasks.length > 0 && today.guide.tasks.every((task) => task.status === 'done');
      if (!allTasksDone) throw new Error('当前学习日还有未完成任务，请完成所有任务后再生成下一批任务。');
      await this.store.closeCurrentSession(today.guide.id);
      review = await this.generateReviewSafely(today.guide.id, today.guide.date, deps.generateReview);
    } else if (today.guide?.sessionStatus === 'closed') {
      review = await this.store.getLatestReview(today.guide.date);
      if (!review) review = await this.generateReviewSafely(today.guide.id, today.guide.date, deps.generateReview);
    }

    const next = await this.prepareCurrentLearningDay({}, deps);
    if (next.todayState !== 'plan_exhausted') return { review, ...next };
    return {
      review,
      todayState: 'plan_exhausted',
      errorMessage: '当前批次学习任务已全部完成。请前往复盘页查看总结，复盘后可根据当前学习路径生成下一批任务。'
    };
  }

  async closeCompletedLearningDay(): Promise<boolean> {
    const today = await this.store.getActiveGuide();
    if (!today.guide || today.guide.tasks.length === 0) return false;
    if (!today.guide.tasks.every((task) => task.status === 'done')) return false;
    await this.store.closeCurrentSession(today.guide.id);
    return true;
  }

  private async generateReviewSafely(
    guideId: Id,
    date: string,
    generateReview: (guideId: Id) => Promise<ReviewResult>
  ): Promise<ReviewResult | null> {
    try {
      return await generateReview(guideId);
    } catch (error) {
      await this.store.saveAiReview({
        kind: 'reflection', date, provider: 'deepseek', model: 'configured',
        inputSnapshot: { guideId }, output: {}, outputSchemaVersion: 'review.v1', status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async generateRollingPlan(params: { goalId: Id }, deps: GenerateRollingPlanDeps): Promise<GenerateRollingPlanResult> {
    const { goalId } = params;
    const { shortPlanAgent, dailyGuideAgent, getRuntimeSettings, saveAiReview, createTraceId, todayIso } = deps;

    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new Error('找不到要续生计划的学习目标。');

    await this.store.markRoadmapStageReadyForReview(goal.id);

    const stageResult = await this.store.findActiveOrActivateStage(goal.id);
    if (stageResult === 'goal_completed') {
      throw new Error('当前学习目标的所有阶段都已完成。请创建新的学习目标或重新开始。');
    }
    if (stageResult === 'stage_review_required') {
      throw new Error('当前阶段已完成全部学习单元，需先在复盘页确认阶段成果，再进入下一阶段。');
    }
    if (!stageResult) {
      throw new Error('没有可用的学习阶段。请先生成学习路径。');
    }
    const activeStage = stageResult;

    const [brief, profile, runtimeSettings, knowledgeCtx] = await Promise.all([
      this.store.getGoalBriefForGoal(goal.id),
      this.store.getPromptProfile(),
      getRuntimeSettings(),
      this.store.getKnowledgeContextForGoal(goal.id)
    ]);
    const knowledgeItemsForGuide = knowledgeCtx.knowledgeItems;
    const reviewItemsForGuide = knowledgeCtx.reviewKnowledgeItems;

    const availableStageDays = await this.store.listAvailableShortPlanDaysForStage(goal.id, activeStage.id);
    const existingStageDay = availableStageDays[0] ?? null;

    const reuseDay = async (targetDay: ShortPlanDay) => {
      const activated = await this.store.activateShortPlanDay(targetDay.id);
      if (!activated) throw new Error('激活已有计划项失败，请重试。');
      const activeGuideState = await this.store.getActiveGuide();
      const boundedContext = await this.store.buildContext('generate_daily_guide', {
        shortPlanDay: targetDay,
        availableMinutes: runtimeSettings.dailyStudyWindows
      });
      const dailyGuideOutput = await dailyGuideAgent.run({
        date: todayIso(),
        windows: runtimeSettings.dailyStudyWindows,
        goal,
        brief,
        roadmap: activeGuideState.roadmap,
        targetDay,
        context: boundedContext.context,
        profile,
        settings: runtimeSettings,
        knowledgeItems: knowledgeItemsForGuide,
        reviewKnowledgeItems: reviewItemsForGuide,
        traceId: createTraceId(),
        onMetrics: () => {}
      });
      const saved = await this.store.saveDailyGuideWithTransaction({
        goal, date: todayIso(), windows: runtimeSettings.dailyStudyWindows, shortPlanDayId: targetDay.id, dailyGuide: dailyGuideOutput
      });
      const fullState = await this.store.getActiveGuide();
      return { goal, roadmap: fullState.roadmap, shortPlan: fullState.shortPlan, guide: saved.guide, activatedStage: activeStage };
    };

    if (existingStageDay) {
      return reuseDay(existingStageDay);
    }

    const completedContext = await this.store.getRollingPlanContext(goal.id);
    const reviewSummary = completedContext?.reviewSummary;

    const traceId = createTraceId();
    const rollingContext = await this.store.buildContext('generate_rolling_plan', {
      completedDays: completedContext?.summary ?? '暂无已完成任务',
      remainingDays: availableStageDays
    });
    const rollingOutput = await shortPlanAgent.runRolling({
      goal, brief, activeStage, completedSummary: completedContext?.summary ?? '暂无已完成任务', reviewSummary, profile, settings: runtimeSettings, knowledgeItems: knowledgeItemsForGuide, reviewKnowledgeItems: reviewItemsForGuide, context: rollingContext.context, traceId, onMetrics: () => {}
    });

    await saveAiReview({
      kind: 'rolling_plan', provider: 'deepseek', model: runtimeSettings.deepseekModel, promptProfileId: profile.id, promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId: goal.id, stageId: activeStage.id, contextSourceIds: rollingContext.contextSourceIds }, output: rollingOutput, outputSchemaVersion: 'rolling-plan.v1', status: 'success'
    });

    const newPlanDays = await this.store.saveRollingPlanDays({
      goalId: goal.id, roadmapStageId: activeStage.id,
      items: rollingOutput.days.map((day: any) => ({ dayIndex: day.dayIndex, title: day.title, focus: day.focus, tasks: day.tasks, expectedOutput: day.expectedOutput, successCriteria: day.successCriteria }))
    });

    const firstDay = newPlanDays.sort((a: ShortPlanDay, b: ShortPlanDay) => a.dayIndex - b.dayIndex)[0] ?? null;
    if (!firstDay) throw new Error('AI 未返回有效学习任务');

    const activated = await this.store.activateShortPlanDay(firstDay.id);
    if (!activated) throw new Error('激活新计划项失败，请重试。');

    const activeGuideState = await this.store.getActiveGuide();
    const dailyGuideContext = await this.store.buildContext('generate_daily_guide', {
      shortPlanDay: firstDay,
      availableMinutes: runtimeSettings.dailyStudyWindows
    });
    const dailyGuideOutput = await dailyGuideAgent.run({
      date: todayIso(), windows: runtimeSettings.dailyStudyWindows, goal, brief, roadmap: activeGuideState.roadmap, targetDay: firstDay, profile, settings: runtimeSettings, knowledgeItems: knowledgeItemsForGuide, reviewKnowledgeItems: reviewItemsForGuide, context: dailyGuideContext.context, traceId: createTraceId(), onMetrics: () => {}
    });
    const saved = await this.store.saveDailyGuideWithTransaction({
      goal, date: todayIso(), windows: runtimeSettings.dailyStudyWindows, shortPlanDayId: firstDay.id, dailyGuide: dailyGuideOutput
    });
    const fullState = await this.store.getActiveGuide();
    return { goal, roadmap: fullState.roadmap, shortPlan: fullState.shortPlan, guide: saved.guide, activatedStage: activeStage };
  }

  async getPlanVersionsForGoal(goalId: Id): Promise<PlanVersionEntry[]> {
    return this.store.getPlanVersionsForGoal(goalId);
  }

  async proposePlanChange(goalId: Id, proposal: PlanProposalInput): Promise<PlanAdjustmentProposal> {
    return this.store.createProposal(goalId, proposal);
  }

  async confirmPlanChange(proposalId: Id): Promise<PlanAdjustmentProposal> {
    return this.store.confirmProposal(proposalId);
  }

  async rejectPlanChange(proposalId: Id): Promise<PlanAdjustmentProposal> {
    return this.store.rejectProposal(proposalId);
  }

  async confirmRoadmapStage(goalId: Id, stageId: Id): Promise<RoadmapStage[]> {
    return this.store.confirmRoadmapStageCompletion(goalId, stageId);
  }

}
