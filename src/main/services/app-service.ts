import type { BrowserWindow } from 'electron';
import { ipcChannels } from '../../shared/ipc';
import { localDateIso } from '../../shared/date';
import type { AnswerStepQuestionAgentOutput, DailyGuideAgentOutput, GoalIntakeAgentOutput, NextStepDecisionAgentOutput, RoadmapAgentOutput, ShortPlanAgentOutput, SubmissionEvaluationAgentOutput } from '../../shared/schemas';
import type { AppSettings, DailyGuide, DailyGuideTask, DailyPlanBlock, GenerateRollingPlanResult, GoalBrief, Id, KnowledgeItem, KnowledgeItemStatus, LayeredPlanResult, LearnerFactScope, LearnerFactSource, LearningSubmission, PlanProposalInput, PrepareCurrentLearningDayResult, ReviewResult, RoadmapStage, RuntimeAuditResult, ShortPlanDay, StartNextSessionResult, StudySession, SubmissionEvaluationResult, TodayGuideState, TodayState } from '../../shared/types';
import { AiClient } from '../ai/ai-client';
import { CategorizedError } from '../ai/categorized-error';
import { AgentLoop } from '../agent/agent-loop';
import type { AgentContext, AgentRunAudit, AgentToolName } from '../agent/agent-types';
import { createBuiltinToolRegistry } from '../agent/tools/builtin-tools';
import { FocusMonitor } from './focus-monitor';
import type { SettingsService } from './settings-service';
import type { StudyStore } from './store';
import { isPassingEvaluation } from '../domain/execution-state-machine';
import { LearningModules } from '../modules';

function createTraceId(): string {
  return `ta_${crypto.randomUUID()}`;
}

const DEDUP_TTL_MS = 5_000;
const FORCE_START_MESSAGE = '请使用当前信息生成初步计划。';

export class AppService {
  private readonly aiClient = new AiClient();
  private readonly agentLoop: AgentLoop;
  private readonly focusMonitor: FocusMonitor;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly recentResults = new Map<string, { result: unknown; error: boolean; expiresAt: number }>();
  private startupRuntimeAudit: RuntimeAuditResult | null = null;
  readonly modules: LearningModules;

  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {
    this.focusMonitor = new FocusMonitor(store);
    this.modules = new LearningModules(store);
    this.agentLoop = new AgentLoop(
      createBuiltinToolRegistry(this.aiClient, async ({ goalId, query, limit }) => {
        const items = await this.store.getKnowledgeItemsForGoal({
          goalId,
          status: 'active',
          limit: limit ?? 20
        });
        const normalized = query?.trim().toLocaleLowerCase();
        return normalized
          ? items.filter((item) =>
              `${item.key} ${item.summary} ${item.detail ?? ''}`.toLocaleLowerCase().includes(normalized)
            )
          : items;
      }),
      store
    );
  }

  async initialize(): Promise<void> {
    await this.agentLoop.recoverInterruptedRuns();
    this.startupRuntimeAudit = await this.runRuntimeAudit();
    const recovery = await this.store.recoverPendingEvaluationProgress();
    if (recovery.recovered > 0) {
      // eslint-disable-next-line no-console
      console.log(`[P2] recoverPendingEvaluationProgress: recovered=${recovery.recovered}`);
    }
  }

  private dedupe<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const cached = this.recentResults.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.error
        ? Promise.reject(cached.result)
        : Promise.resolve(cached.result as T);
    }

    const promise = fn().then(
      (result) => {
        this.inFlight.delete(key);
        this.recentResults.set(key, { result, error: false, expiresAt: Date.now() + ttlMs });
        return result;
      },
      (error) => {
        this.inFlight.delete(key);
        this.recentResults.set(key, { result: error, error: true, expiresAt: Date.now() + ttlMs });
        throw error;
      }
    );
    this.inFlight.set(key, promise);
    return promise;
  }

  getSettings() {
    return this.settings.getAppSettings();
  }

  async getLearningStyle(): Promise<'concise' | 'detailed' | 'code_first'> {
    const value = await this.store.getSetting('learningStyle');
    if (value === 'concise' || value === 'detailed' || value === 'code_first') {
      return value;
    }
    return 'detailed';
  }

  updateSettings(patch: Partial<AppSettings> & { deepseekApiKey?: string }) {
    return this.settings.updateSettings(patch);
  }

  async getCurrentOnboarding() {
    const state = await this.store.getCurrentGoalIntake();
    return this.withPendingInteraction(state);
  }

  sendOnboardingMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new CategorizedError('user_input_error', '访谈内容不能为空。');
    }
    return this.dedupe(
      `onboarding:${trimmed}`,
      DEDUP_TTL_MS,
      () => this._sendOnboardingMessage(trimmed)
    );
  }

  private async _sendOnboardingMessage(content: string) {
    const current = await this.store.getCurrentGoalIntake();
    const pending = await this.agentLoop.getOpenInteraction('goal_intake', current.intake.id);
    if (pending && pending.expectedContextVersion !== current.messages.length) {
      throw new CategorizedError(
        'validation_error',
        '目标访谈内容已经变化，原问题没有被自动套用。请刷新后重新回答。'
      );
    }
    await this.store.addGoalIntakeMessage(current.intake.id, 'user', content);
    const [nextState, profile, runtimeSettings] = await Promise.all([
      this.store.getCurrentGoalIntake(),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const recentMessages = nextState.messages.slice(-12);
    const intakeContext = await this.modules.context.build('goal_intake', {
      messages: recentMessages,
      latestUserInput: content
    });
    const traceId = createTraceId();
    const input = {
      messages: recentMessages,
      context: intakeContext.context,
      profile,
      settings: runtimeSettings,
      traceId
    };
    const context: AgentContext = {
      kind: 'goal_intake',
      scopeType: 'goal_intake',
      scopeId: current.intake.id,
      goalId: current.intake.goalId ?? undefined,
      contextVersion: nextState.messages.length + 1
    };
    const audit: AgentRunAudit = {
      kind: 'goal_intake',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: {
        intakeId: current.intake.id,
        messageCount: nextState.messages.length,
        contextSourceIds: intakeContext.contextSourceIds
      },
      outputSchemaVersion: 'goal-intake.v1'
    };
    let run;
    try {
      run = pending
        ? await this.agentLoop.resume<typeof input, GoalIntakeAgentOutput>({
            pendingInteractionId: pending.id,
            answer: content,
            expectedContextVersion: pending.expectedContextVersion,
            resolution: content === FORCE_START_MESSAGE ? 'skipped' : 'answered',
            input,
            context,
            audit,
            toolName: 'propose_goal'
          })
        : await this.runAgentTool<typeof input, GoalIntakeAgentOutput>({
            toolName: 'propose_goal',
            input,
            context,
            audit
          });
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'ai_failure',
        '访谈响应失败，请重试。',
        error instanceof Error ? error : undefined
      );
    }
    const saved = await this.store.saveGoalIntakeAgentOutput(current.intake.id, run.output);
    return this.withPendingInteraction(saved);
  }

  private async withPendingInteraction<T extends { intake: { id: string } }>(
    state: T
  ): Promise<T & { pendingInteraction: Awaited<ReturnType<AgentLoop['getOpenInteraction']>> }> {
    const pendingInteraction = await this.agentLoop.getOpenInteraction('goal_intake', state.intake.id);
    return { ...state, pendingInteraction };
  }

  async cancelOnboardingQuestion() {
    const state = await this.store.getCurrentGoalIntake();
    const pending = await this.agentLoop.getOpenInteraction('goal_intake', state.intake.id);
    if (pending) {
      await this.agentLoop.cancelPendingInteraction(pending.id);
    }
    return this.withPendingInteraction(await this.store.getCurrentGoalIntake());
  }

  async confirmOnboardingGoal(briefPatch?: Partial<GoalBrief>) {
    const intake = await this.store.getCurrentGoalIntake();
    if (intake.intake.status === 'confirmed' && intake.intake.goalId) {
      const goal = await this.store.getGoal(intake.intake.goalId);
      if (goal) return { goal, intake: intake.intake };
    }
    return this.store.confirmGoalIntake(briefPatch);
  }

  listHistory() {
    return this.store.listGoalIntakes();
  }

  getHistoryIntake(intakeId: Id) {
    return this.store.getGoalIntakeById(intakeId);
  }

  async generateLayeredPlan(goalId: Id) {
    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new Error('找不到要生成计划的学习目标。');
    const [brief, profile, runtimeSettings] = await Promise.all([
      this.store.getGoalBriefForGoal(goalId),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const date = todayIso();
    const windows = runtimeSettings.dailyStudyWindows;

    const roadmapTraceId = createTraceId();
    const roadmapContext = await this.modules.context.build('generate_roadmap', {
      goalUnderstanding: brief,
      availableTime: runtimeSettings.dailyStudyWindows
    });
    const roadmapInput = {
      goal,
      brief,
      context: roadmapContext.context,
      profile,
      settings: runtimeSettings,
      traceId: roadmapTraceId
    };
    const roadmapRun = await this.runAgentTool<typeof roadmapInput, RoadmapAgentOutput>({
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
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
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
      status: 'pending',
      position: index,
      createdAt: '',
      updatedAt: ''
    }));

    const shortPlanTraceId = createTraceId();
    const shortPlanContext = await this.modules.context.build('generate_short_plan', {
      goalUnderstanding: brief,
      roadmap: draftRoadmap,
      availableTime: runtimeSettings.dailyStudyWindows
    });
    const shortPlanInput = {
      mode: 'initial' as const,
      goal,
      brief,
      roadmap: draftRoadmap,
      context: shortPlanContext.context,
      profile,
      settings: runtimeSettings,
      traceId: shortPlanTraceId
    };
    const shortPlanRun = await this.runAgentTool<typeof shortPlanInput, ShortPlanAgentOutput>({
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
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
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
    const draftShortPlan = shortPlanOutput.days.map<ShortPlanDay>((day) => ({
      id: `draft-short-day-${day.dayIndex}`,
      goalId,
      roadmapStageId: null,
      dayIndex: day.dayIndex,
      date: day.dayIndex === 1 ? date : null,
      sessionStatus: 'pending',
      title: day.title,
      focus: day.focus,
      tasks: day.tasks,
      expectedOutput: day.expectedOutput,
      successCriteria: day.successCriteria,
      locked: false,
      createdAt: ''
    }));
    const { knowledgeItems: initialKnowledge, reviewKnowledgeItems: initialReviewKnowledge } = await this.store.getKnowledgeContextForGoal(goalId);
    let dailyGuideOutput: DailyGuideAgentOutput;
    const dailyGuideTraceId = createTraceId();
    const dailyGuideContext = await this.modules.context.build('generate_daily_guide', {
      shortPlanDay: draftShortPlan.find((d) => d.dayIndex === 1),
      availableMinutes: windows
    });
    try {
      const dailyGuideInput = {
        date,
        windows,
        goal,
        brief,
        roadmap: draftRoadmap,
        targetDay: draftShortPlan.find((d) => d.dayIndex === 1)!,
        context: dailyGuideContext.context,
        profile,
        settings: runtimeSettings,
        knowledgeItems: initialKnowledge,
        reviewKnowledgeItems: initialReviewKnowledge,
        traceId: dailyGuideTraceId
      };
      const dailyGuideRun = await this.runAgentTool<typeof dailyGuideInput, DailyGuideAgentOutput>({
        toolName: 'prepare_learning_guide',
        input: dailyGuideInput,
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
          provider: 'deepseek',
          model: runtimeSettings.deepseekModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: {
            goalId,
            brief,
            roadmap: roadmapOutput,
            shortPlan: shortPlanOutput,
            contextSourceIds: dailyGuideContext.contextSourceIds
          },
          outputSchemaVersion: 'daily-guide.v2'
        }
      });
      dailyGuideOutput = dailyGuideRun.output;
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      if (error instanceof Error && /DeepSeek API Key|API [Kk]ey/i.test(error.message)) {
        throw new CategorizedError('missing_config', error.message, error);
      }
      if (error instanceof Error && /JSON|schema|valid|parse|required|expected/i.test(error.message)) {
        throw new CategorizedError(
          'schema_violation',
          '生成今日执行稿失败：AI 返回内容格式不完整，已阻止写入。请重试一次，或在设置里调低提示词复杂度。',
          error
        );
      }
      throw new CategorizedError(
        'ai_failure',
        '生成今日执行稿失败：AI 调用出错，已记录失败。请重试一次。',
        error instanceof Error ? error : undefined
      );
    }
    const result = await this.store.saveLayeredPlan({
      goal,
      brief,
      date,
      windows,
      roadmap: roadmapOutput,
      shortPlan: shortPlanOutput,
      dailyGuide: dailyGuideOutput
    });
    return result;
  }

  async confirmDailyGuide(guideId: Id) {
    const existing = await this.store.getDailyGuideById(guideId);
    if (existing && existing.status === 'confirmed') {
      return existing;
    }
    return this.store.confirmDailyGuide(guideId);
  }

  async archiveTodayAndRestart() {
    const active = await this.getActiveSession();
    if (active?.session.status === 'active') {
      this.focusMonitor.stop();
      const paused = await this.modules.runtime.pauseSession(active.session.id);
      await this.pushSessionState(paused);
    }
    return this.store.archiveTodayGuides(todayIso());
  }

  async startNextSession(goalId?: Id): Promise<StartNextSessionResult> {
    return this.modules.planning.advanceLearningDay(
      { goalId },
      {
        runAgentTool: <TInput, TOutput>(params: {
          toolName: AgentToolName;
          input: TInput;
          context: AgentContext;
          audit: AgentRunAudit;
        }) => this.runAgentTool<TInput, TOutput>(params),
        getRuntimeSettings: () => this.settings.getRuntimeSettings(),
        createTraceId,
        todayIso,
        generateReview: (guideId) => this.generateReviewForClosedGuide(guideId)
      }
    ).catch((error) => {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError('validation_error', error instanceof Error ? error.message : String(error));
    });
  }

  private async generateReviewForClosedGuide(guideId: string): Promise<ReviewResult> {
    const guide = await this.store.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Guide not found: ${guideId}`);
    return this.generateReviewForDay(guide.date, guide.id);
  }

  private runAgentTool<TInput, TOutput>(params: {
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }) {
    return this.agentLoop.run<TInput, TOutput>(params);
  }

  async generateReview(date: string) {
    return this.generateReviewForDay(date, date);
  }

  private async generateReviewForDay(date: string, summaryRefId: string): Promise<ReviewResult> {
    const snapshot = await this.store.getDaySnapshot(date);
    const [profile, runtimeSettings] = await Promise.all([
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const traceId = createTraceId();
    const reviewContext = await this.modules.context.build('generate_review');
    const summaryRun = await this.store.beginLearningSummary('day', summaryRefId);
    let run;
    try {
      const input = {
        date,
        snapshot,
        context: reviewContext.context,
        profile,
        settings: runtimeSettings,
        traceId
      };
      run = await this.runAgentTool<typeof input, Omit<ReviewResult, 'reviewId' | 'date'>>({
        toolName: 'reflect',
        input,
        context: {
          kind: 'review',
          scopeType: 'learning_summary',
          scopeId: summaryRefId,
          contextVersion: 1
        },
        audit: {
          kind: 'reflection',
          date,
          provider: 'deepseek',
          model: runtimeSettings.deepseekModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: {
            daySnapshot: snapshot,
            contextSourceIds: reviewContext.contextSourceIds
          },
          outputSchemaVersion: 'review.v1'
        }
      });
      await this.store.completeLearningSummary(summaryRun.id, run.output);
    } catch (error) {
      await this.store.failLearningSummary(summaryRun.id, error instanceof CategorizedError ? error.category : 'ai_failure');
      throw error;
    }
    return { reviewId: run.runReviewId, date, ...run.output };
  }

  async getTodayState(): Promise<TodayState> {
    const today = await this.store.getActiveGuide();
    if (!today.goal) return 'needs_goal';

    const goalId = today.goal.id;
    if (this.modules.planning.isPreparing(goalId)) return 'generating';
    const usedShortPlanDayIds = await this.store.getUsedShortPlanDayIds(goalId);
    const hasRecoverablePlanDay = today.shortPlan.some((day) =>
      day.sessionStatus === 'active' && !usedShortPlanDayIds.has(day.id)
    );

    const hasAvailablePlanDay = today.shortPlan.some((day) =>
      day.sessionStatus === 'pending' &&
      day.date === null &&
      !usedShortPlanDayIds.has(day.id)
    );
    const guide = today.guide;
    const stageReviewRequired = today.roadmap.some((stage) => stage.status === 'ready_for_review');
    if (guide) {
      if (guide.sessionStatus === 'draft') return 'generation_failed';
      if (guide.status === 'completed' || guide.sessionStatus === 'closed') {
        if (stageReviewRequired) return 'stage_review_required';
        return hasAvailablePlanDay ? 'completed' : 'plan_exhausted';
      }
      return 'active';
    }

    if (stageReviewRequired) return 'stage_review_required';
    if (!hasRecoverablePlanDay && !hasAvailablePlanDay) return 'plan_exhausted';

    return 'ready_to_generate';
  }

  async prepareCurrentLearningDay(forceRetry = false): Promise<PrepareCurrentLearningDayResult> {
    return this.modules.planning.prepareCurrentLearningDay(
      { forceRetry },
      {
        runAgentTool: <TInput, TOutput>(params: {
          toolName: AgentToolName;
          input: TInput;
          context: AgentContext;
          audit: AgentRunAudit;
        }) => this.runAgentTool<TInput, TOutput>(params),
        getRuntimeSettings: () => this.settings.getRuntimeSettings(),
        createTraceId,
        todayIso
      }
    );
  }

  async generateRollingPlan(goalId: Id): Promise<GenerateRollingPlanResult> {
    return this.modules.planning.generateRollingPlan(
      { goalId },
      {
        runAgentTool: <TInput, TOutput>(params: {
          toolName: AgentToolName;
          input: TInput;
          context: AgentContext;
          audit: AgentRunAudit;
        }) => this.runAgentTool<TInput, TOutput>(params),
        getRuntimeSettings: () => this.settings.getRuntimeSettings(),
        createTraceId,
        todayIso
      }
    ).catch((error) => {
      if (error instanceof CategorizedError) throw error;
      if (error instanceof Error && /找不到|没有可用|未返回有效|激活.*失败/.test(error.message)) {
        throw new CategorizedError('validation_error', error.message);
      }
      throw new CategorizedError('ai_failure', error instanceof Error ? error.message : String(error));
    });
  }

  async listTodayGuide(): Promise<TodayGuideState> {
    const [today, todayState, context] = await Promise.all([
      this.store.getActiveGuide(),
      this.getTodayState(),
      this.store.getCurrentLearningContext()
    ]);
    const pendingEvaluations = today.goal
      ? await this.store.getPendingEvaluationIdsForGoal(today.goal.id)
      : [];
    return {
      ...today,
      currentStage: today.roadmap.find((stage) => stage.id === context.stageId) ?? null,
      stageConflict: context.stageConflict,
      todayState,
      pendingEvaluations
    };
  }

  getLatestReview(date?: string): Promise<ReviewResult | null> {
    return this.store.getLatestReview(date);
  }

  getKnowledgeItemsForGoal(params: { goalId: string; status?: KnowledgeItemStatus; limit?: number }): Promise<KnowledgeItem[]> {
    return this.store.getKnowledgeItemsForGoal(params);
  }

  async auditRuntimeConsistency(): Promise<RuntimeAuditResult> {
    if (this.startupRuntimeAudit) {
      const result = this.startupRuntimeAudit;
      this.startupRuntimeAudit = null;
      return result;
    }
    return this.runRuntimeAudit();
  }

  private async runRuntimeAudit(): Promise<RuntimeAuditResult> {
    const result = await this.store.auditRuntimeConsistency();
    const [guideChoices, learningUnitChoices] = await Promise.all([
      this.store.listCurrentGuideChoices(),
      this.store.listAmbiguousLearningUnits()
    ]);
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      requiresUserAction: result.conflicts.length > 0,
      guideChoices,
      learningUnitChoices
    };
  }

  async selectCurrentGuide(guideId: Id): Promise<RuntimeAuditResult> {
    this.startupRuntimeAudit = null;
    await this.store.selectCurrentGuide(guideId);
    return this.runRuntimeAudit();
  }

  async resolveLearningUnit(guideId: Id, decision: 'restore' | 'skip'): Promise<RuntimeAuditResult> {
    this.startupRuntimeAudit = null;
    await this.store.resolveAmbiguousLearningUnit(guideId, decision);
    return this.runRuntimeAudit();
  }

  async exportGoalData(goalId: Id): Promise<Record<string, unknown>> {
    return this.store.exportGoalData(goalId);
  }

  async getPlanVersionsForGoal(goalId: Id) {
    return this.modules.planning.getPlanVersionsForGoal(goalId);
  }

  getTokenCostStats(opts: { goalId?: string; operation?: string; fromDate?: string; toDate?: string }) {
    return this.store.getTokenCostStats(opts);
  }

  async createPlanProposal(goalId: Id, proposal: PlanProposalInput) {
    return this.modules.planning.proposePlanChange(goalId, proposal);
  }

  async confirmPlanProposal(proposalId: Id) {
    return this.modules.planning.confirmPlanChange(proposalId);
  }

  async rejectPlanProposal(proposalId: Id) {
    return this.modules.planning.rejectPlanChange(proposalId);
  }

  async confirmRoadmapStage(goalId: Id, stageId: Id) {
    return this.modules.planning.confirmRoadmapStage(goalId, stageId);
  }

  async startSession(taskId: Id) {
    const session = await this.modules.runtime.startSession(taskId);
    this.focusMonitor.start(session.id);
    this.getMainWindow()?.flashFrame(true);
    await this.pushSessionState(session);
    return session;
  }

  async pauseSession(sessionId: Id) {
    this.focusMonitor.stop();
    const session = await this.modules.runtime.pauseSession(sessionId);
    await this.pushSessionState(session);
    return session;
  }

  async getActiveSession(): Promise<{ session: StudySession; block: DailyPlanBlock | null } | null> {
    let context = await this.store.getCurrentLearningContext();
    if (!context.session) {
      const sessions = await this.store.listSessions();
      if (sessions.some((session) => session.status === 'active' || session.status === 'paused')) {
        await this.store.auditRuntimeConsistency();
        context = await this.store.getCurrentLearningContext();
      }
    }
    return context.session ? { session: context.session, block: null } : null;
  }

  async getAccumulatedSeconds(blockId: string, excludeSessionId?: string): Promise<number> {
    return this.store.getAccumulatedSeconds(blockId, excludeSessionId);
  }

  getLearningState() {
    return this.modules.runtime.getSnapshot();
  }

  async teachCurrentStep(promptProfileId?: Id) {
    const learningStyle = await this.getLearningStyle();
    const [built, profile, runtimeSettings] = await Promise.all([
      this.modules.context.build('teach_step', { learningStyle }),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    if (!built.snapshot.dailyGuideAction) {
      throw new Error('当前没有可展开的学习步骤。请先开始今日任务。');
    }
    const traceId = createTraceId();
    const input = {
      mode: 'teach' as const,
      context: built.context,
      profile,
      settings: runtimeSettings,
      traceId
    };
    const run = await this.runAgentTool<typeof input, {
      explanation: string;
      userAction: string;
      requiresSubmission: boolean;
    }>({
      toolName: 'explain',
      input,
      context: {
        kind: 'study',
        scopeType: 'learning_action',
        scopeId: built.snapshot.dailyGuideAction.id,
        goalId: built.snapshot.goal?.id,
        contextVersion: 1
      },
      audit: {
        kind: 'teach_step',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { contextSourceIds: built.contextSourceIds, context: built.context },
        outputSchemaVersion: 'teach-step.v1'
      }
    });
    const output = run.output;
    return {
      action: built.snapshot.dailyGuideAction,
      explanation: output.explanation,
      userAction: output.userAction,
      requiresSubmission: output.requiresSubmission,
      contextSourceIds: built.contextSourceIds
    };
  }

  completeCurrentAction() {
    return this.modules.runtime.dispatch({ type: 'completeCurrentAction' });
  }

  skipCurrentAction() {
    return this.modules.runtime.dispatch({ type: 'skipCurrentAction' });
  }

  async skipCurrentTask() {
    let snapshot = await this.modules.runtime.dispatch({ type: 'skipCurrentTask' });
    this.focusMonitor.stop();
    if (!snapshot.dailyGuideTask) {
      const prepared = await this.modules.planning.prepareCurrentLearningDay(
        {},
        {
          runAgentTool: <TInput, TOutput>(params: {
            toolName: AgentToolName;
            input: TInput;
            context: AgentContext;
            audit: AgentRunAudit;
          }) => this.runAgentTool<TInput, TOutput>(params),
          getRuntimeSettings: () => this.settings.getRuntimeSettings(),
          createTraceId,
          todayIso
        }
      );
      if (prepared.todayState === 'active') {
        await this.store.auditRuntimeConsistency();
        snapshot = await this.modules.runtime.getSnapshot();
      } else if (prepared.todayState === 'generation_failed') {
        throw new CategorizedError(
          'validation_error',
          `当前任务已跳过并保存在记录中，但下一轮任务生成失败：${prepared.errorMessage ?? '请重试生成。'}`
        );
      } else if (prepared.todayState === 'generating') {
        throw new CategorizedError('validation_error', '当前任务已跳过，下一轮任务正在生成，请稍后重新检查。');
      }
    }
    return snapshot;
  }

  async terminateLearning() {
    const snapshot = await this.modules.runtime.dispatch({ type: 'endCurrentSession' });
    this.focusMonitor.stop();
    return snapshot;
  }

  askStepQuestion(question: string, promptProfileId?: Id) {
    const trimmed = question.trim();
    if (!trimmed) {
      throw new CategorizedError('user_input_error', '问题不能为空。');
    }
    const actionId = this.store.getActiveStepId() ?? 'none';
    return this.dedupe(
      `question:${actionId}:${trimmed}`,
      DEDUP_TTL_MS,
      () => this._askStepQuestion(trimmed, promptProfileId)
    );
  }

  private async _askStepQuestion(question: string, promptProfileId?: Id) {
    const before = await this.store.getLearningRuntimeSnapshot();
    const actionId = before.dailyGuideAction!.id;
    const goalId = before.goal?.id ?? '';
    const taskId = before.state.activeDailyTaskId ?? '';

    let threadId: string;
    if (before.questionThread?.status === 'open') {
      threadId = before.questionThread.id;
      await this.store.addQuestionMessage(threadId, 'user', question);
    } else {
      const handle = await this.modules.branch.open('question', { goalId, taskId, actionId }, question);
      threadId = handle.threadId;
    }

    const [built, profile, runtimeSettings] = await Promise.all([
      this.modules.context.build('answer_step_question', { question }),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    const questionTraceId = createTraceId();
    let output;
    try {
      const input = {
        mode: 'question' as const,
        question,
        context: built.context,
        profile,
        settings: runtimeSettings,
        traceId: questionTraceId
      };
      const run = await this.runAgentTool<typeof input, AnswerStepQuestionAgentOutput>({
        toolName: 'explain',
        input,
        context: {
          kind: 'study',
          scopeType: 'question_thread',
          scopeId: threadId,
          goalId,
          contextVersion: 1
        },
        audit: {
          kind: 'question',
          provider: 'deepseek',
          model: runtimeSettings.deepseekModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: { contextSourceIds: built.contextSourceIds, question },
          outputSchemaVersion: 'question-answer.v1'
        }
      });
      output = run.output;
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'ai_failure',
        '回答问题时出错，请重试。',
        error instanceof Error ? error : undefined
      );
    }
    const updatedThread = await this.store.saveQuestionAnswer(threadId, output);
    const messages = await this.store.getQuestionMessages(threadId);
    return {
      thread: updatedThread,
      messages,
      answer: output.answer,
      resolved: output.resolved,
      returnToStepInstruction: output.returnToStepInstruction
    };
  }

  async resolveQuestion(threadId: Id, summary?: string) {
    await this.store.resolveQuestion(threadId, summary);
    return this.store.getLearningRuntimeSnapshot();
  }

  async createBranch(kind: 'question' | 'debug' | 'practice', anchor: { goalId: Id; taskId: Id; actionId: Id | null }, initialContent?: string) {
    return this.modules.branch.open(kind, anchor, initialContent);
  }

  async appendBranchMessage(threadId: Id, role: 'user' | 'assistant', content: string) {
    return this.modules.branch.append(threadId, role, content);
  }

  async closeBranch(threadId: Id, strategy: string, options?: { summary?: string; factProposal?: any; promoteTaskId?: Id }) {
    return this.modules.branch.close(threadId, strategy as any, options);
  }

  async promoteBranch(threadId: Id, taskId: Id, summary?: string) {
    return this.modules.branch.promote(threadId, { taskId, summary });
  }

  async getBranchThread(threadId: Id) {
    return this.modules.branch.getThread(threadId);
  }

  async getBranchMessages(threadId: Id) {
    return this.modules.branch.getMessages(threadId);
  }

  submitLearningResult(content: string, promptProfileId?: Id) {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('提交内容不能为空。');
    }
    const actionId = this.store.getActiveStepId() ?? 'none';
    return this.dedupe(
      `submit:${actionId}:${trimmed}`,
      DEDUP_TTL_MS,
      () => this._submitLearningResult(trimmed, promptProfileId)
    );
  }

  private async _submitLearningResult(content: string, promptProfileId?: Id) {
    const before = await this.store.getLearningRuntimeSnapshot();
    if (!before.dailyGuideAction) {
      throw new Error('当前没有学习步骤，无法提交结果。');
    }
    const allActionsTerminal = Boolean(
      before.dailyGuideTask?.actions.length
      && before.dailyGuideTask.actions.every((action) => action.status === 'done' || action.status === 'skipped')
    );
    if (!allActionsTerminal) {
      throw new CategorizedError('validation_error', '请先完成或跳过当前任务的全部步骤，再提交结果。');
    }
    const active = await this.getActiveSession();
    const submission = await this.store.createSubmission(before.dailyGuideAction.id, active?.session.id ?? null, content);
    if (active?.session.status === 'active') {
      this.focusMonitor.stop();
      const paused = await this.store.pauseSession(active.session.id);
      await this.pushSessionState(paused);
    }
    return this.evaluateSavedSubmission(submission, promptProfileId);
  }

  retrySubmissionEvaluation(submissionId: Id, promptProfileId?: Id) {
    return this.dedupe(
      `retry-evaluation:${submissionId}`,
      DEDUP_TTL_MS,
      async () => {
        const submission = await this.store.getSubmissionById(submissionId);
        if (!submission) {
          throw new CategorizedError('user_input_error', '找不到需要重试的提交记录。');
        }
        if (submission.evaluationStatus === 'completed') {
          throw new CategorizedError('validation_error', '这条提交已经完成评价，无需重复评价。');
        }
        return this.evaluateSavedSubmission(submission, promptProfileId, true);
      }
    );
  }

  private async evaluateSavedSubmission(
    submission: LearningSubmission,
    promptProfileId?: Id,
    resetExistingLock = false
  ): Promise<SubmissionEvaluationResult> {
    const before = await this.store.getLearningRuntimeSnapshot();
    if (!before.dailyGuideAction || before.dailyGuideAction.id !== submission.dailyGuideActionId) {
      throw new CategorizedError('validation_error', '当前学习位置与这条提交不一致，无法自动重试评价。');
    }

    const evaluationLockKey = `evaluation:${submission.id}`;
    if (resetExistingLock) {
      // 用户显式重试表示上一次尝试不再有效，同时清理进程异常退出后遗留的持久锁。
      await this.store.releaseGenerationLock(evaluationLockKey);
    }
    const acquired = await this.store.acquireGenerationLock(evaluationLockKey);
    if (!acquired) {
      throw new CategorizedError('validation_error', '这条提交正在评价中，请稍后再试。');
    }

    try {
      await this.store.markSubmissionEvaluation(submission.id, 'evaluating');
      const active = await this.getActiveSession();
    const guideTask = before.dailyGuideTask;
    const activeGuideForEval = await this.store.getActiveGuide(true);
    const goalIdForEval = activeGuideForEval.goal?.id;
    const [evaluationContext, profile, runtimeSettings, evalKnowledgeCtx] = await Promise.all([
      this.modules.context.build('evaluate_submission', { submission: submission.content }),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings(),
      goalIdForEval ? this.store.getKnowledgeContextForGoal(goalIdForEval) : Promise.resolve({ knowledgeItems: [], reviewKnowledgeItems: [] })
    ]);
    let evaluationAiReviewId: string | undefined;
    let evaluationOutput;
    if (guideTask?.evaluationMode === 'local') {
      evaluationOutput = buildLocalSubmissionEvaluation(submission.content, guideTask);
    } else {
      try {
        const input = {
          submission: submission.content,
          context: evaluationContext.context,
          profile,
          settings: runtimeSettings,
          knowledgeItems: evalKnowledgeCtx.knowledgeItems,
          reviewKnowledgeItems: evalKnowledgeCtx.reviewKnowledgeItems,
          traceId: createTraceId()
        };
        const run = await this.runAgentTool<typeof input, SubmissionEvaluationAgentOutput>({
          toolName: 'evaluate',
          input,
          context: {
            kind: 'evaluation',
            scopeType: 'submission',
            scopeId: submission.id,
            goalId: goalIdForEval,
            contextVersion: 1
          },
          audit: {
            kind: 'submission_evaluation',
            provider: 'deepseek',
            model: runtimeSettings.deepseekModel,
            promptProfileId: profile.id,
            promptVersionId: profile.activeVersionId,
            inputSnapshot: {
              contextSourceIds: evaluationContext.contextSourceIds,
              submissionId: submission.id
            },
            outputSchemaVersion: 'submission-evaluation.v1'
          }
        });
        evaluationOutput = run.output;
        evaluationAiReviewId = run.runReviewId;
      } catch (error) {
        await this.store.markSubmissionEvaluation(submission.id, 'failed');
        if (error instanceof CategorizedError) throw error;
        throw new CategorizedError(
          'ai_failure',
          '评价提交时出错，已保存你的提交内容。请重试评价。',
          error instanceof Error ? error : undefined
        );
      }
    }
    const decisionOutput = buildLocalDecisionFromEvaluation(evaluationOutput);
    const result = await this.store.saveEvaluationAndDecision({
      submission,
      evaluationOutput,
      decisionOutput,
      evaluationAiReviewId
    });
    await this.modules.context.processEvaluationResult({
      goalId: goalIdForEval ?? '',
      taskId: guideTask?.id,
      submissionId: submission.id,
      evaluationId: result.evaluation.id,
      evaluationOutput,
      taskDoneWhen: guideTask?.doneWhen,
      taskTitle: guideTask?.title
    });
    if (result.decision.taskCompleted && active?.session) {
      this.focusMonitor.stop();
    }
      const appliedSubmission = await this.store.getSubmissionById(submission.id);
      if (!appliedSubmission) throw new Error('评价已完成，但无法重新读取提交记录。');
      return {
        submission: appliedSubmission,
        evaluation: result.evaluation,
        decision: result.decision,
        nextAction: result.nextAction
      };
    } finally {
      await this.store.releaseGenerationLock(evaluationLockKey);
    }
  }

  decidePlanAdjustment(proposalId: Id, status: 'accepted' | 'rejected') {
    return this.store.decidePlanAdjustment(proposalId, status);
  }

  async pushSessionState(session: StudySession): Promise<void> {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(ipcChannels.sessionStateChanged, { session, block: null });
    }
  }

  listPrompts() {
    return this.store.listPromptProfiles();
  }

  updatePrompt(profileId: Id, content: string) {
    return this.store.updatePrompt(profileId, content);
  }

  proposeLearnerFact(goalId: string, fact: { scope: LearnerFactScope; taskId?: string; key: string; value: string; source: LearnerFactSource; confidence?: number }) {
    return this.modules.context.proposeFact(goalId, fact);
  }

  listLearnerFacts(goalId: string, scope?: LearnerFactScope) {
    return this.modules.context.listFactsForGoal(goalId, scope);
  }

  confirmLearnerFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string) {
    return this.modules.context.confirmFact(goalId, key, scope, taskId);
  }

  deleteLearnerFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string) {
    return this.modules.context.deleteFact(goalId, key, scope, taskId);
  }
}

function todayIso(): string {
  return localDateIso();
}

function buildLocalDecisionFromEvaluation(evaluation: SubmissionEvaluationAgentOutput): NextStepDecisionAgentOutput {
  if (isPassingEvaluation(evaluation)) {
    return {
      decision: 'complete_task',
      reason: evaluation.feedback,
      taskCompleted: true,
      nextStep: null,
      remediation: null,
      carryForward: ''
    };
  }

  const decision = evaluation.recommendedAction === 'advance' || evaluation.recommendedAction === 'complete_task'
    ? 'remediate'
    : evaluation.recommendedAction;
  return {
    decision,
    reason: evaluation.feedback,
    taskCompleted: false,
    nextStep: null,
    remediation: null,
    carryForward: evaluation.missingRequirements[0] ?? evaluation.misconceptions[0] ?? ''
  };
}

function buildLocalSubmissionEvaluation(content: string, task: DailyGuideTask): SubmissionEvaluationAgentOutput {
  const trimmed = content.trim();
  const passed = trimmed.length >= 10;
  return {
    result: passed ? 'passed' : 'unclear',
    mastery: passed ? 100 : 30,
    evidence: passed
      ? [`已提交：${truncateForLocalEvaluation(trimmed)}`, ...task.doneWhen]
      : ['提交内容过短，本地检查无法确认已完成。'],
    correctParts: passed ? ['提交了主任务最终产出。'] : [],
    misconceptions: [],
    missingRequirements: passed ? [] : task.doneWhen,
    feedback: passed
      ? '本地检查通过：已收到主任务最终产出。'
      : '本地检查未通过：请补充可验收的最终产出后再提交。',
    recommendedAction: passed ? 'complete_task' : 'request_user_decision',
    decision: passed ? 'advance' : 'stay'
  };
}

function truncateForLocalEvaluation(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 119)}…`;
}
