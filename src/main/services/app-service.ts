import type { BrowserWindow } from 'electron';
import { ipcChannels } from '../../shared/ipc';
import { localDateIso } from '../../shared/date';
import type { DailyGuideAgentOutput, NextStepDecisionAgentOutput, SubmissionEvaluationAgentOutput } from '../../shared/schemas';
import type { AppSettings, DailyGuide, DailyGuideTask, DailyPlanBlock, GenerateRollingPlanResult, GoalBrief, Id, KnowledgeItem, KnowledgeItemStatus, LayeredPlanResult, LearnerFactScope, LearnerFactSource, LearningSubmission, PlanProposalInput, PrepareCurrentLearningDayResult, ReviewResult, RoadmapStage, RuntimeAuditResult, ShortPlanDay, StartNextSessionResult, StudySession, SubmissionEvaluationResult, TodayGuideState, TodayState } from '../../shared/types';
import { AiClient, type AiCallMetrics } from '../ai/ai-client';
import { CategorizedError } from '../ai/categorized-error';
import {
  DailyGuideAgent,
  GoalIntakeAgent,
  ReflectionAgent,
  RoadmapAgent,
  ShortPlanAgent,
  StepQuestionAgent,
  SubmissionEvaluationAgent,
  TeachStepAgent
} from '../ai/agents';
import { FocusMonitor } from './focus-monitor';
import type { SettingsService } from './settings-service';
import type { StudyStore } from './store';
import { isPassingEvaluation } from '../domain/execution-state-machine';
import { LearningModules } from '../modules';

function createTraceId(): string {
  return `ta_${crypto.randomUUID()}`;
}

const DEDUP_TTL_MS = 5_000;

export class AppService {
  private readonly aiClient = new AiClient();
  private readonly reflectionAgent = new ReflectionAgent(this.aiClient);
  private readonly goalIntakeAgent = new GoalIntakeAgent(this.aiClient);
  private readonly roadmapAgent = new RoadmapAgent(this.aiClient);
  private readonly shortPlanAgent = new ShortPlanAgent(this.aiClient);
  private readonly dailyGuideAgent = new DailyGuideAgent(this.aiClient);
  private readonly teachStepAgent = new TeachStepAgent(this.aiClient);
  private readonly questionAgent = new StepQuestionAgent(this.aiClient);
  private readonly evaluationAgent = new SubmissionEvaluationAgent(this.aiClient);
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
  }

  async initialize(): Promise<void> {
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

  getCurrentOnboarding() {
    return this.store.getCurrentGoalIntake();
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
    let metrics: AiCallMetrics | undefined;
    let output;
    try {
      output = await this.goalIntakeAgent.run({
        messages: recentMessages,
        context: intakeContext.context,
        profile,
        settings: runtimeSettings,
        traceId,
        onMetrics: (m) => { metrics = m; }
      });
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'ai_failure',
        '访谈响应失败，请重试。',
        error instanceof Error ? error : undefined
      );
    }
    await this.store.saveAiReview({
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
      output,
      outputSchemaVersion: 'goal-intake.v1',
      status: 'success',
      metrics
    });
    return this.store.saveGoalIntakeAgentOutput(current.intake.id, output);
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
    let roadmapMetrics: AiCallMetrics | undefined;
    const roadmapContext = await this.modules.context.build('generate_roadmap', {
      goalUnderstanding: brief,
      availableTime: runtimeSettings.dailyStudyWindows
    });
    const roadmapOutput = await this.roadmapAgent.run({
      goal,
      brief,
      context: roadmapContext.context,
      profile,
      settings: runtimeSettings,
      traceId: roadmapTraceId,
      onMetrics: (m) => { roadmapMetrics = m; }
    });
    await this.store.saveAiReview({
      kind: 'roadmap',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId, brief, contextSourceIds: roadmapContext.contextSourceIds },
      output: roadmapOutput,
      outputSchemaVersion: 'roadmap.v1',
      status: 'success',
      metrics: roadmapMetrics
    });
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
    let shortPlanMetrics: AiCallMetrics | undefined;
    const shortPlanContext = await this.modules.context.build('generate_short_plan', {
      goalUnderstanding: brief,
      roadmap: draftRoadmap,
      availableTime: runtimeSettings.dailyStudyWindows
    });
    const shortPlanOutput = await this.shortPlanAgent.run({
      goal,
      brief,
      roadmap: draftRoadmap,
      context: shortPlanContext.context,
      profile,
      settings: runtimeSettings,
      traceId: shortPlanTraceId,
      onMetrics: (m) => { shortPlanMetrics = m; }
    });
    await this.store.saveAiReview({
      kind: 'short_plan',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId, brief, roadmap: roadmapOutput, contextSourceIds: shortPlanContext.contextSourceIds },
      output: shortPlanOutput,
      outputSchemaVersion: 'short-plan.v1',
      status: 'success',
      metrics: shortPlanMetrics
    });
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
    let dailyGuideMetrics: AiCallMetrics | undefined;
    const dailyGuideContext = await this.modules.context.build('generate_daily_guide', {
      shortPlanDay: draftShortPlan.find((d) => d.dayIndex === 1),
      availableMinutes: windows
    });
    try {
      dailyGuideOutput = await this.dailyGuideAgent.run({
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
        traceId: dailyGuideTraceId,
        onMetrics: (m) => { dailyGuideMetrics = m; }
      });
      await this.store.saveAiReview({
        kind: 'daily_guide',
        date,
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { goalId, brief, roadmap: roadmapOutput, shortPlan: shortPlanOutput, contextSourceIds: dailyGuideContext.contextSourceIds },
        output: dailyGuideOutput,
        outputSchemaVersion: 'daily-guide.v2',
        status: 'success',
        metrics: dailyGuideMetrics
      });
    } catch (error) {
      const resolvedCategory = dailyGuideMetrics?.errorCategory ?? 'ai_failure';
      if (dailyGuideMetrics) {
        dailyGuideMetrics = { ...dailyGuideMetrics, errorCategory: resolvedCategory };
      }
      await this.store.saveAiReview({
        kind: 'daily_guide',
        date,
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { goalId, brief, roadmap: roadmapOutput, shortPlan: shortPlanOutput, contextSourceIds: dailyGuideContext.contextSourceIds },
        output: {},
        outputSchemaVersion: 'daily-guide.v2',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        metrics: dailyGuideMetrics
      });
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
        dailyGuideAgent: this.dailyGuideAgent,
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
    const snapshot = await this.store.getDaySnapshot(guide.date);
    const [profile, runtimeSettings] = await Promise.all([
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const traceId = createTraceId();
    let metrics: AiCallMetrics | undefined;
    const reviewContext = await this.modules.context.build('generate_review');
    const summaryRun = await this.store.beginLearningSummary('day', guide.id);
    let output;
    try {
      output = await this.reflectionAgent.run({
        date: guide.date,
        snapshot,
        context: reviewContext.context,
        profile,
        settings: runtimeSettings,
        traceId,
        onMetrics: (m) => { metrics = m; }
      });
      await this.store.completeLearningSummary(summaryRun.id, output);
    } catch (error) {
      await this.store.failLearningSummary(summaryRun.id, error instanceof CategorizedError ? error.category : 'ai_failure');
      throw error;
    }
    const reviewId = await this.store.saveAiReview({
      kind: 'reflection',
      date: guide.date,
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { daySnapshot: snapshot, contextSourceIds: reviewContext.contextSourceIds },
      output,
      outputSchemaVersion: 'review.v1',
      status: 'success',
      metrics
    });
    return { reviewId, date: guide.date, ...output };
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
    if (hasRecoverablePlanDay) return 'generation_failed';

    const hasAvailablePlanDay = today.shortPlan.some((day) =>
      day.sessionStatus === 'pending' &&
      day.date === null &&
      !usedShortPlanDayIds.has(day.id)
    );
    const guide = today.guide;
    if (guide) {
      if (guide.sessionStatus === 'draft') return 'generation_failed';
      if (guide.status === 'completed' || guide.sessionStatus === 'closed') {
        return hasAvailablePlanDay ? 'completed' : 'plan_exhausted';
      }
      return 'active';
    }

    if (!hasAvailablePlanDay) return 'plan_exhausted';

    return 'ready_to_generate';
  }

  async prepareCurrentLearningDay(forceRetry = false): Promise<PrepareCurrentLearningDayResult> {
    return this.modules.planning.prepareCurrentLearningDay(
      { forceRetry },
      {
        dailyGuideAgent: this.dailyGuideAgent,
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
        shortPlanAgent: this.shortPlanAgent,
        dailyGuideAgent: this.dailyGuideAgent,
        getRuntimeSettings: () => this.settings.getRuntimeSettings(),
        saveAiReview: (params) => this.store.saveAiReview(params),
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
    const [today, todayState] = await Promise.all([
      this.store.getActiveGuide(),
      this.getTodayState()
    ]);
    const pendingEvaluations = today.goal
      ? await this.store.getPendingEvaluationIdsForGoal(today.goal.id)
      : [];
    return { ...today, todayState, pendingEvaluations };
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
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      requiresUserAction: result.conflicts.length > 0
    };
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

  /**
   * @deprecated 使用 skipCurrentTask() 代替。保留仅用于 IPC 兼容。
   */
  async skipBlock(_blockId: Id, _reason: string) {
    return this.modules.runtime.dispatch({ type: 'skipCurrentTask' });
  }

  async generateReview(date: string) {
    const [snapshot, profile, runtimeSettings] = await Promise.all([
      this.store.getDaySnapshot(date),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const traceId = createTraceId();
    let metrics: AiCallMetrics | undefined;
    const reviewContext = await this.modules.context.build('generate_review');
    const summaryRun = await this.store.beginLearningSummary('day', date);
    let output;
    try {
      output = await this.reflectionAgent.run({
        date,
        snapshot,
        context: reviewContext.context,
        profile,
        settings: runtimeSettings,
        traceId,
        onMetrics: (m) => { metrics = m; }
      });
      await this.store.completeLearningSummary(summaryRun.id, output);
    } catch (error) {
      await this.store.failLearningSummary(summaryRun.id, error instanceof CategorizedError ? error.category : 'ai_failure');
      throw error;
    }
    const reviewId = await this.store.saveAiReview({
      kind: 'reflection',
      date,
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { daySnapshot: snapshot, contextSourceIds: reviewContext.contextSourceIds },
      output,
      outputSchemaVersion: 'review.v1',
      status: 'success',
      metrics
    });
    return {
      reviewId,
      date,
      ...output
    };
  }

  async getActiveSession(): Promise<{ session: StudySession; block: DailyPlanBlock | null } | null> {
    const sessions = await this.store.listSessions();
    const active = sessions.find((s) => s.status === 'active' || s.status === 'paused');
    if (!active || !active.taskId) return null;
    const guideTaskSnapshot = await this.store.getLearningRuntimeSnapshot();
    const guideTask = guideTaskSnapshot.dailyGuideTask;
    if (!guideTask) return null;
    if (guideTask.status === 'done' || guideTask.status === 'skipped' || guideTask.status === 'deferred') {
      return null;
    }
    return { session: active, block: null };
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
    let metrics: AiCallMetrics | undefined;
    const output = await this.teachStepAgent.run({
      context: built.context,
      profile,
      settings: runtimeSettings,
      traceId,
      onMetrics: (m) => { metrics = m; }
    });
    const aiReviewId = await this.store.saveAiReview({
      kind: 'teach_step',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { contextSourceIds: built.contextSourceIds, context: built.context },
      output,
      outputSchemaVersion: 'teach-step.v1',
      status: 'success',
      metrics
    });
    void aiReviewId;
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

  skipCurrentTask() {
    return this.modules.runtime.dispatch({ type: 'skipCurrentTask' });
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
    let questionMetrics: AiCallMetrics | undefined;
    let output;
    try {
      output = await this.questionAgent.run({
        question,
        context: built.context,
        profile,
        settings: runtimeSettings,
        traceId: questionTraceId,
        onMetrics: (m) => { questionMetrics = m; }
      });
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'ai_failure',
        '回答问题时出错，请重试。',
        error instanceof Error ? error : undefined
      );
    }
    await this.store.saveAiReview({
      kind: 'question',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { contextSourceIds: built.contextSourceIds, question },
      output,
      outputSchemaVersion: 'question-answer.v1',
      status: 'success',
      metrics: questionMetrics
    });
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
    const active = await this.getActiveSession();
    const submission = await this.store.createSubmission(before.dailyGuideAction.id, active?.session.id ?? null, content);
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
    let evaluationMetrics: AiCallMetrics | undefined;
    let evaluationOutput;
    if (guideTask?.evaluationMode === 'local') {
      evaluationOutput = buildLocalSubmissionEvaluation(submission.content, guideTask);
    } else {
      try {
        evaluationOutput = await this.evaluationAgent.run({
          submission: submission.content,
          context: evaluationContext.context,
          profile,
          settings: runtimeSettings,
          knowledgeItems: evalKnowledgeCtx.knowledgeItems,
          reviewKnowledgeItems: evalKnowledgeCtx.reviewKnowledgeItems,
          traceId: createTraceId(),
          onMetrics: (m) => { evaluationMetrics = m; }
        });
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
    if (guideTask?.evaluationMode !== 'local') {
      evaluationAiReviewId = await this.store.saveAiReview({
        kind: 'submission_evaluation',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          contextSourceIds: evaluationContext.contextSourceIds,
          submissionId: submission.id
        },
        output: evaluationOutput,
        outputSchemaVersion: 'submission-evaluation.v1',
        status: 'success',
        metrics: evaluationMetrics
      });
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
