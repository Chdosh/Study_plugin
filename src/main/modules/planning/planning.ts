import type { DailyGuideAgentOutput, RoadmapAgentOutput, ShortPlanAgentOutput } from '../../../shared/schemas';
import { localDateIso } from '../../../shared/date';
import type {
  GenerateRollingPlanResult,
  Id,
  LayeredPlanResult,
  LearningGoal,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PrepareCurrentLearningUnitResult,
  RoadmapStage,
  NearTermPlanItem
} from '../../../shared/types';
import { CategorizedError, describeError } from '../../ai/categorized-error';
import type { AgentContext, AgentRunAudit, AgentToolName } from '../../agent/agent-types';
import type { StudyStore } from '../../services/store';
import type { SettingsService } from '../../services/settings-service';
import type { LearningTurnModule } from '../learning-turn/learning-turn';

export type PlanningStore = Pick<StudyStore,
  | 'getGoal'
  | 'getActiveGuide'
  | 'getUsedNearTermPlanItemIds'
  | 'activateNearTermPlanItem'
  | 'getPreviousCompletedLearningDayContext'
  | 'getGoalBriefForGoal'
  | 'getPromptProfile'
  | 'getKnowledgeContextForGoal'
  | 'saveDailyGuideWithTransaction'
  | 'ensureDraftDailyGuide'
  | 'acquireGenerationLock'
  | 'releaseGenerationLock'
  | 'findActiveOrActivateStage'
  | 'listAvailableNearTermPlanItemsForStage'
  | 'getRollingPlanContext'
  | 'saveRollingPlanDays'
  | 'getPlanVersionsForGoal'
  | 'createProposal'
  | 'confirmProposal'
  | 'markRoadmapStageReadyForReview'
  | 'confirmRoadmapStageCompletion'
  | 'buildContext'
  | 'saveLayeredPlan'
>;

export interface PrepareCurrentLearningUnitDeps {
  startAgentTurn: <TInput, TOutput>(params: {
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }) => Promise<{ runReviewId: string; output: TOutput }>;
  getRuntimeSettings: () => Promise<any>;
  createTraceId: () => string;
  todayIso: () => string;
}

export interface GenerateRollingPlanDeps {
  startAgentTurn: PrepareCurrentLearningUnitDeps['startAgentTurn'];
  getRuntimeSettings: () => Promise<any>;
  createTraceId: () => string;
  todayIso: () => string;
  onError?: (error: unknown) => void;
}

export class PlanningModule {
  private readonly generationLocks = new Map<string, Promise<PrepareCurrentLearningUnitResult>>();

  constructor(
    private readonly store: PlanningStore,
    private readonly settings?: SettingsService,
    private readonly learningTurn?: LearningTurnModule
  ) {}

  isPreparing(goalId: Id): boolean {
    return this.generationLocks.has(`daily_guide:${goalId}`);
  }

  async generateLayeredPlan(goalId: Id): Promise<LayeredPlanResult> {
    if (!this.settings || !this.learningTurn) {
      throw new Error('PlanningModule 缺少首次计划生成依赖。');
    }
    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new Error('找不到要生成计划的学习目标。');
    const [brief, profile, runtimeSettings] = await Promise.all([
      this.store.getGoalBriefForGoal(goalId),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const date = localDateIso();
    const windows = runtimeSettings.dailyStudyWindows;

    const roadmapContext = await this.store.buildContext('generate_roadmap', {
      goalUnderstanding: brief,
      availableTime: windows
    });
    const roadmapInput = {
      goal,
      brief,
      context: roadmapContext.context,
      profile,
      settings: runtimeSettings,
      traceId: `ta_${crypto.randomUUID()}`
    };
    const roadmapRun = await this.learningTurn.startTool<typeof roadmapInput, RoadmapAgentOutput>({
      toolName: 'propose_roadmap',
      input: roadmapInput,
      context: {
        kind: 'planning',
        scopeType: 'goal_plan',
        scopeId: goalId,
        goalId,
        contextVersion: 1
      },
      audit: {
        kind: 'roadmap',
        provider: 'configured_ai',
        model: runtimeSettings.aiModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { goalId, brief, contextSourceIds: roadmapContext.contextSourceIds },
        outputSchemaVersion: 'roadmap.v1'
      }
    });
    const roadmapOutput = roadmapRun.output;
    const draftRoadmap = roadmapOutput.stages.map<RoadmapStage>((stage, index) => ({
      id: `draft-roadmap-${index}`,
      goalId,
      title: stage.title,
      objective: stage.objective,
      direction: stage.direction,
      successCriteria: stage.successCriteria,
      targetDate: stage.targetDate,
      status: 'pending',
      position: index,
      createdAt: '',
      updatedAt: ''
    }));

    const shortPlanContext = await this.store.buildContext('generate_short_plan', {
      goalUnderstanding: brief,
      roadmap: draftRoadmap,
      availableTime: windows
    });
    const shortPlanInput = {
      mode: 'initial' as const,
      goal,
      brief,
      roadmap: draftRoadmap,
      context: shortPlanContext.context,
      profile,
      settings: runtimeSettings,
      traceId: `ta_${crypto.randomUUID()}`
    };
    const shortPlanRun = await this.learningTurn.startTool<typeof shortPlanInput, ShortPlanAgentOutput>({
      toolName: 'propose_short_plan',
      input: shortPlanInput,
      context: {
        kind: 'planning',
        scopeType: 'goal_plan',
        scopeId: goalId,
        goalId,
        contextVersion: 2
      },
      audit: {
        kind: 'short_plan',
        provider: 'configured_ai',
        model: runtimeSettings.aiModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          goalId,
          brief,
          roadmap: roadmapOutput,
          contextSourceIds: shortPlanContext.contextSourceIds
        },
        outputSchemaVersion: 'short-plan.v1'
      }
    });
    const shortPlanOutput = shortPlanRun.output;
    const draftPlanItems = shortPlanOutput.items.map<NearTermPlanItem>((item) => ({
      id: `draft-plan-item-${item.itemIndex}`,
      goalId,
      roadmapStageId: null,
      itemIndex: item.itemIndex,
      date: null,
      sessionStatus: 'pending',
      title: item.title,
      focus: item.focus,
      tasks: item.tasks,
      expectedOutput: item.expectedOutput,
      successCriteria: item.successCriteria,
      locked: false,
      createdAt: ''
    }));
    const targetPlanItem = draftPlanItems.find((item) => item.itemIndex === 1);
    if (!targetPlanItem) {
      throw new CategorizedError(
        'schema_violation',
        '近期计划没有可用于当前 Learning Guide 的首个学习单元。'
      );
    }
    const knowledge = await this.store.getKnowledgeContextForGoal(goalId);
    const guideContext = await this.store.buildContext('generate_daily_guide', {
      shortPlanDay: targetPlanItem,
      availableMinutes: windows
    });
    let dailyGuideOutput: DailyGuideAgentOutput;
    try {
      const guideInput = {
        date,
        windows,
        goal,
        brief,
        roadmap: draftRoadmap,
        targetDay: targetPlanItem,
        context: guideContext.context,
        profile,
        settings: runtimeSettings,
        knowledgeItems: knowledge.knowledgeItems,
        reviewKnowledgeItems: knowledge.reviewKnowledgeItems,
        traceId: `ta_${crypto.randomUUID()}`
      };
      const guideRun = await this.learningTurn.startTool<typeof guideInput, DailyGuideAgentOutput>({
        toolName: 'prepare_learning_guide',
        input: guideInput,
        context: {
          kind: 'planning',
          scopeType: 'goal_plan',
          scopeId: goalId,
          goalId,
          contextVersion: 3
        },
        audit: {
          kind: 'daily_guide',
          date,
          provider: 'configured_ai',
          model: runtimeSettings.aiModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: {
            goalId,
            brief,
            roadmap: roadmapOutput,
            shortPlan: shortPlanOutput,
            contextSourceIds: [
              ...guideContext.contextSourceIds,
              ...knowledge.knowledgeItems.map((item) => item.id),
              ...knowledge.reviewKnowledgeItems.map((item) => item.id)
            ]
          },
          outputSchemaVersion: 'daily-guide.v2'
        }
      });
      dailyGuideOutput = guideRun.output;
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      if (error instanceof Error && /AI API Key|API [Kk]ey/i.test(error.message)) {
        throw new CategorizedError('missing_config', error.message, error);
      }
      if (error instanceof Error && /JSON|schema|valid|parse|required|expected/i.test(error.message)) {
        throw new CategorizedError(
          'schema_violation',
          '生成当前 Learning Guide 失败：AI 返回内容格式不完整，已阻止写入。请重试一次，或在设置里调低提示词复杂度。',
          error
        );
      }
      throw new CategorizedError(
        'ai_failure',
        '生成当前 Learning Guide 失败：AI 调用出错，已记录失败。请重试一次。',
        error instanceof Error ? error : undefined
      );
    }
try {
      return await this.store.saveLayeredPlan({
        goal,
        brief,
        date,
        windows,
        roadmap: roadmapOutput,
        shortPlan: shortPlanOutput,
        dailyGuide: dailyGuideOutput
      });
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'validation_error',
        `学习计划保存失败：${error instanceof Error ? error.message : '未知错误'}。`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async prepareCurrentLearningUnit(
    params: { forceRetry?: boolean },
    deps: PrepareCurrentLearningUnitDeps
  ): Promise<PrepareCurrentLearningUnitResult> {
    // A failed generation intentionally leaves a draft Guide as the durable
    // recovery anchor. Reading only active Guides would hide that draft and
    // incorrectly report that the Goal no longer exists on retry.
    let today = await this.store.getActiveGuide();
    if (!today.goal) return { preparationState: 'needs_goal' };

    await this.store.markRoadmapStageReadyForReview(today.goal.id);
    today = await this.store.getActiveGuide();
    if (!today.goal) return { preparationState: 'needs_goal' };
    if (today.roadmap.some((stage) => stage.status === 'ready_for_review')) {
      return { preparationState: 'stage_review_required' };
    }

    const lockKey = `daily_guide:${today.goal.id}`;
    const existingLock = this.generationLocks.get(lockKey);
    if (existingLock) return existingLock;

    if (params.forceRetry) await this.store.releaseGenerationLock(lockKey);
    if (!await this.store.acquireGenerationLock(lockKey)) return { preparationState: 'generating' };

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
    shortPlan: NearTermPlanItem[],
    existingGuide: Awaited<ReturnType<PlanningStore['getActiveGuide']>>['guide'],
    deps: PrepareCurrentLearningUnitDeps
  ): Promise<PrepareCurrentLearningUnitResult> {
    const pendingDraft = existingGuide?.sessionStatus === 'draft' && existingGuide.tasks.length === 0;
    if (existingGuide && !pendingDraft) {
      return { preparationState: existingGuide.status === 'completed' ? 'completed' : 'active' };
    }

    const traceId = deps.createTraceId();
    const date = deps.todayIso();
    let contextSourceIds: string[] = [];
    let targetDay: NearTermPlanItem | null = null;
    let profile: Awaited<ReturnType<PlanningStore['getPromptProfile']>> | undefined;
    let settings: Awaited<ReturnType<PrepareCurrentLearningUnitDeps['getRuntimeSettings']>> | undefined;

    try {
      const usedDayIds = await this.store.getUsedNearTermPlanItemIds(goal.id);
      const activeStageId = roadmap.find((stage) => stage.status === 'active')?.id ?? null;
      targetDay = pendingDraft
        ? shortPlan.find((item) => item.id === existingGuide.nearTermPlanItemId) ?? null
        : shortPlan.find((day) => day.roadmapStageId === activeStageId && day.sessionStatus === 'active' && !usedDayIds.has(day.id)) ?? null;
      const isRetry = targetDay !== null;
      if (!targetDay) {
        targetDay = shortPlan
          .filter((day) => day.roadmapStageId === activeStageId && day.sessionStatus === 'pending' && !usedDayIds.has(day.id))
          .sort((a, b) => a.itemIndex - b.itemIndex)[0] ?? null;
      }
      if (!targetDay) return { preparationState: 'plan_exhausted' };

      if (!isRetry && !await this.store.activateNearTermPlanItem(targetDay.id)) {
        return { preparationState: 'generating' };
      }

      const previousDayResult = isRetry
        ? undefined
        : await this.store.getPreviousCompletedLearningDayContext(goal.id) ?? undefined;
      const [brief, loadedProfile, loadedSettings, knowledge] = await Promise.all([
        this.store.getGoalBriefForGoal(goal.id),
        this.store.getPromptProfile(),
        deps.getRuntimeSettings(),
        this.store.getKnowledgeContextForGoal(goal.id)
      ]);
      profile = loadedProfile;
      settings = loadedSettings;

      await this.store.ensureDraftDailyGuide({
        goal, date, windows: settings.dailyStudyWindows, nearTermPlanItemId: targetDay.id
      });

      const boundedContext = await this.store.buildContext('generate_daily_guide', {
        shortPlanDay: targetDay,
        previousDayResult,
        availableMinutes: settings.dailyStudyWindows
      });
      contextSourceIds = boundedContext.contextSourceIds;

      const toolInput = {
        date, windows: settings.dailyStudyWindows, goal, brief, roadmap, targetDay,
        previousDayResult, profile, settings, knowledgeItems: knowledge.knowledgeItems,
        reviewKnowledgeItems: knowledge.reviewKnowledgeItems, context: boundedContext.context, traceId
      };
      const toolRun = await deps.startAgentTurn<typeof toolInput, DailyGuideAgentOutput>({
        toolName: 'prepare_learning_guide',
        input: toolInput,
        context: {
          kind: 'planning',
          scopeType: 'short_plan_day',
          scopeId: targetDay.id,
          goalId: goal.id,
          contextVersion: 1
        },
        audit: {
          kind: 'daily_guide',
          date,
          provider: 'configured_ai',
          model: settings.aiModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: { goalId: goal.id, targetDay: targetDay.title, contextSourceIds },
          outputSchemaVersion: 'daily-guide.v2'
        }
      });
      const output = toolRun.output;

      const result = await this.store.saveDailyGuideWithTransaction({
        goal, date, windows: settings.dailyStudyWindows,
        nearTermPlanItemId: targetDay.id, dailyGuide: output
      });

      return { preparationState: 'active', result };
    } catch (error) {
      const described = describeError(error);
      return { preparationState: 'generation_failed', errorMessage: described.message };
    }
  }

  async generateRollingPlan(params: { goalId: Id }, deps: GenerateRollingPlanDeps): Promise<GenerateRollingPlanResult> {
    const { goalId } = params;
    const { startAgentTurn, getRuntimeSettings, createTraceId, todayIso } = deps;

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

    const availableStageDays = await this.store.listAvailableNearTermPlanItemsForStage(goal.id, activeStage.id);
    const existingStageDay = availableStageDays[0] ?? null;

    const createGuideForActivatedDay = async (targetDay: NearTermPlanItem) => {
      const activated = await this.store.activateNearTermPlanItem(targetDay.id);
      if (!activated) throw new Error('激活计划项失败，请重试。');
      const activeGuideState = await this.store.getActiveGuide();
      const boundedContext = await this.store.buildContext('generate_daily_guide', {
        shortPlanDay: targetDay,
        availableMinutes: runtimeSettings.dailyStudyWindows
      });
      const guideInput = {
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
        traceId: createTraceId()
      };
      const guideRun = await startAgentTurn<typeof guideInput, DailyGuideAgentOutput>({
        toolName: 'prepare_learning_guide',
        input: guideInput,
        context: {
          kind: 'planning',
          scopeType: 'short_plan_day',
          scopeId: targetDay.id,
          goalId: goal.id,
          contextVersion: 1
        },
        audit: {
          kind: 'daily_guide',
          date: todayIso(),
          provider: 'configured_ai',
          model: runtimeSettings.aiModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: {
            goalId: goal.id,
            targetDayId: targetDay.id,
            contextSourceIds: boundedContext.contextSourceIds
          },
          outputSchemaVersion: 'daily-guide.v2'
        }
      });
      const dailyGuideOutput = guideRun.output;
      const saved = await this.store.saveDailyGuideWithTransaction({
        goal, date: todayIso(), windows: runtimeSettings.dailyStudyWindows, nearTermPlanItemId: targetDay.id, dailyGuide: dailyGuideOutput
      });
      const fullState = await this.store.getActiveGuide();
      return { goal, roadmap: fullState.roadmap, shortPlan: fullState.shortPlan, guide: saved.guide, activatedStage: activeStage };
    };

    if (existingStageDay) {
      return createGuideForActivatedDay(existingStageDay);
    }

    const completedContext = await this.store.getRollingPlanContext(goal.id);
    const reviewSummary = completedContext?.reviewSummary;

    const traceId = createTraceId();
    const rollingContext = await this.store.buildContext('generate_rolling_plan', {
      completedDays: completedContext?.summary ?? '暂无已完成任务',
      remainingDays: availableStageDays
    });
    const rollingInput = {
      mode: 'rolling' as const,
      goal, brief, activeStage, completedSummary: completedContext?.summary ?? '暂无已完成任务', reviewSummary, profile, settings: runtimeSettings, knowledgeItems: knowledgeItemsForGuide, reviewKnowledgeItems: reviewItemsForGuide, context: rollingContext.context, traceId
    };
    const rollingRun = await startAgentTurn<typeof rollingInput, { items: any[]; weekFocus: string }>({
      toolName: 'propose_short_plan',
      input: rollingInput,
      context: {
        kind: 'planning',
        scopeType: 'roadmap_stage',
        scopeId: activeStage.id,
        goalId: goal.id,
        contextVersion: 1
      },
      audit: {
        kind: 'rolling_plan',
        provider: 'configured_ai',
        model: runtimeSettings.aiModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          goalId: goal.id,
          stageId: activeStage.id,
          contextSourceIds: rollingContext.contextSourceIds
        },
        outputSchemaVersion: 'rolling-plan.v1'
      }
    });
    const rollingOutput = rollingRun.output;
    const expectedStagePosition = activeStage.position + 1;
    if (rollingOutput.items.some((item: any) => item.roadmapStagePosition !== expectedStagePosition)) {
      throw new Error(`滚动计划必须继续当前第 ${expectedStagePosition} 阶段，不能未经确认推进学习阶段。`);
    }

    const newPlanDays = await this.store.saveRollingPlanDays({
      goalId: goal.id, roadmapStageId: activeStage.id,
      items: rollingOutput.items.map((item: any) => ({
        itemIndex: item.itemIndex,
        title: item.title,
        focus: item.focus,
        tasks: item.tasks,
        expectedOutput: item.expectedOutput,
        successCriteria: item.successCriteria
      }))
    });

    const firstDay = newPlanDays.sort((a: NearTermPlanItem, b: NearTermPlanItem) => a.itemIndex - b.itemIndex)[0] ?? null;
    if (!firstDay) throw new Error('AI 未返回有效学习任务');

    return createGuideForActivatedDay(firstDay);
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

  async confirmRoadmapStage(goalId: Id, stageId: Id): Promise<RoadmapStage[]> {
    return this.store.confirmRoadmapStageCompletion(goalId, stageId);
  }

}
