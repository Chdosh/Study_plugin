import type { Id } from '../../../shared/types';
import type { ShortPlanDay } from '../../../shared/types';
import type { GenerateRollingPlanResult } from '../../../shared/types';
import type { StudyStore } from '../../services/store';

export interface GenerateRollingPlanDeps {
  shortPlanAgent: { runRolling(params: any): Promise<any> };
  dailyGuideAgent: { run(params: any): Promise<any> };
  getRuntimeSettings: () => Promise<any>;
  saveAiReview: (params: any) => Promise<string>;
  createTraceId: () => string;
  todayIso: () => string;
  onError?: (error: unknown) => void;
}

export interface PrepareNextUnitParams {
  goalId: Id;
}

export interface PrepareNextUnitResult {
  todayState: 'active' | 'plan_exhausted' | 'generation_failed' | 'needs_goal' | 'completed';
  errorMessage?: string;
}

export interface AdjustmentProposalItem {
  dayIndex: number;
  title: string;
  focus: string;
  expectedOutput: string;
  successCriteria: string;
  reason: string;
}

export interface ApplyAdjustmentResult {
  updatedCount: number;
  skippedLocked: number;
}

export class PlanningModule {
  constructor(private readonly store: StudyStore) {}

  async prepareNextLearningUnit(params: PrepareNextUnitParams): Promise<PrepareNextUnitResult> {
    const goal = await this.store.getGoal(params.goalId);
    if (!goal) return { todayState: 'needs_goal' };

    const today = await this.store.getActiveGuide(true);
    if (!today.goal) return { todayState: 'needs_goal' };

    const goalId = today.goal.id;
    const existingGuide = today.guide;

    if (existingGuide) {
      if (existingGuide.status === 'completed') return { todayState: 'completed' };
      return { todayState: 'active' };
    }

    const usedShortPlanDayIds = await this.store.getUsedShortPlanDayIds(goalId);
    let targetDay: ShortPlanDay | null = today.shortPlan
      .find((d) => d.sessionStatus === 'active' && !usedShortPlanDayIds.has(d.id)) ?? null;
    const isRetry = targetDay !== null;

    if (!targetDay) {
      targetDay = today.shortPlan
        .filter((d) => d.sessionStatus === 'pending' && d.date === null)
        .filter((d) => !usedShortPlanDayIds.has(d.id))
        .sort((a, b) => a.dayIndex - b.dayIndex)[0] ?? null;
    }

    if (!targetDay) {
      return { todayState: 'plan_exhausted' };
    }

    if (!isRetry) {
      const activated = await this.store.activateShortPlanDay(targetDay.id);
      if (!activated) {
        return this.prepareNextLearningUnit(params);
      }
    }

    return { todayState: 'active' };
  }

  async proposeAdjustment(goalId: string, items: AdjustmentProposalItem[]): Promise<ShortPlanDay[]> {
    if (items.length === 0) return [];
    const activeStage = await this.store.getActiveStageForGoal(goalId);
    const allDays = await this.store.getPendingShortPlanDaysForGoal(goalId);
    const updated: ShortPlanDay[] = [];

    for (const item of items) {
      const target = allDays.find((d) => d.dayIndex === item.dayIndex);
      if (!target || target.locked) continue;
      const result = await this.store.updateShortPlanDay(target.id, {
        title: item.title,
        focus: item.focus,
        expectedOutput: item.expectedOutput,
        successCriteria: item.successCriteria
      });
      if (result) updated.push(result);
    }
    return updated;
  }

  async generateRollingPlan(params: { goalId: Id }, deps: GenerateRollingPlanDeps): Promise<GenerateRollingPlanResult> {
    const { goalId } = params;
    const { shortPlanAgent, dailyGuideAgent, getRuntimeSettings, saveAiReview, createTraceId, todayIso } = deps;

    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new Error('找不到要续生计划的学习目标。');

    await this.store.syncRoadmapProgressBeforeRollingPlan(goal.id);

    const stageResult = await this.store.findActiveOrActivateStage(goal.id);
    if (stageResult === 'goal_completed') {
      throw new Error('当前学习目标的所有阶段都已完成。请创建新的学习目标或重新开始。');
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
      const dailyGuideOutput = await dailyGuideAgent.run({
        date: todayIso(),
        windows: runtimeSettings.dailyStudyWindows,
        goal,
        brief,
        roadmap: activeGuideState.roadmap,
        targetDay,
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
    const rollingOutput = await shortPlanAgent.runRolling({
      goal, brief, activeStage, completedSummary: completedContext?.summary ?? '暂无已完成任务', reviewSummary, profile, settings: runtimeSettings, knowledgeItems: knowledgeItemsForGuide, reviewKnowledgeItems: reviewItemsForGuide, traceId, onMetrics: () => {}
    });

    await saveAiReview({
      kind: 'rolling_plan', provider: 'deepseek', model: runtimeSettings.deepseekModel, promptProfileId: profile.id, promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId: goal.id, stageId: activeStage.id }, output: rollingOutput, outputSchemaVersion: 'rolling-plan.v1', status: 'success'
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
    const dailyGuideOutput = await dailyGuideAgent.run({
      date: todayIso(), windows: runtimeSettings.dailyStudyWindows, goal, brief, roadmap: activeGuideState.roadmap, targetDay: firstDay, profile, settings: runtimeSettings, knowledgeItems: knowledgeItemsForGuide, reviewKnowledgeItems: reviewItemsForGuide, traceId: createTraceId(), onMetrics: () => {}
    });
    const saved = await this.store.saveDailyGuideWithTransaction({
      goal, date: todayIso(), windows: runtimeSettings.dailyStudyWindows, shortPlanDayId: firstDay.id, dailyGuide: dailyGuideOutput
    });
    const fullState = await this.store.getActiveGuide();
    return { goal, roadmap: fullState.roadmap, shortPlan: fullState.shortPlan, guide: saved.guide, activatedStage: activeStage };
  }

  async applyAdjustments(goalId: string, adjustments: AdjustmentProposalItem[]): Promise<ApplyAdjustmentResult> {
    if (adjustments.length === 0) return { updatedCount: 0, skippedLocked: 0 };

    const allDays = await this.store.getPendingShortPlanDaysForGoal(goalId);
    let updatedCount = 0;
    let skippedLocked = 0;

    for (const adj of adjustments) {
      const target = allDays.find((d) => d.dayIndex === adj.dayIndex);
      if (!target) continue;
      if (target.locked) {
        skippedLocked++;
        continue;
      }
      await this.store.updateShortPlanDay(target.id, {
        title: adj.title,
        focus: adj.focus,
        expectedOutput: adj.expectedOutput,
        successCriteria: adj.successCriteria
      });
      updatedCount++;
    }

    return { updatedCount, skippedLocked };
  }
}
