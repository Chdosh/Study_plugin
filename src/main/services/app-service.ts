import type { BrowserWindow } from 'electron';
import { ipcChannels } from '../../shared/ipc';
import { localDateIso } from '../../shared/date';
import type { AppSettings, CloseTaskInput, DailyPlanBlock, GenerateRollingPlanResult, GoalBrief, Id, KnowledgeItem, KnowledgeItemStatus, LearnerFactScope, LearnerFactSource, LearningOverviewState, LearningPreparationState, PlanProposalInput, PrepareCurrentLearningUnitResult, ReviewResult, RuntimeAuditResult, StartNextSessionResult, StudySession } from '../../shared/types';
import { AiClient } from '../ai/ai-client';
import { CategorizedError } from '../ai/categorized-error';
import { AgentLoop } from '../agent/agent-loop';
import { AiAgentTurnModel } from '../agent/agent-turn-model';
import type { AgentContext, AgentRunAudit, AgentToolName } from '../agent/agent-types';
import { deriveGoalProgress } from '../domain/goal-progress';
import { createBuiltinToolRegistry } from '../agent/tools/builtin-tools';
import type { SettingsService } from './settings-service';
import type { StudyStore } from './store';
import { LearningModules } from '../modules';

function createTraceId(): string {
  return `ta_${crypto.randomUUID()}`;
}

export class AppService {
  private readonly aiClient = new AiClient();
  private readonly agentLoop: AgentLoop;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private startupRuntimeAudit: RuntimeAuditResult | null = null;
  readonly modules: LearningModules;

  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {
    this.agentLoop = new AgentLoop(
      createBuiltinToolRegistry(async ({ goalId, query, limit }) => {
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
      }, (params) => this.store.insertGuideSupplement(params)),
      store,
      new AiAgentTurnModel(this.aiClient)
    );
    this.modules = new LearningModules(store, settings, this.agentLoop);
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

  private coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().then(
      (result) => {
        this.inFlight.delete(key);
        return result;
      },
      (error) => {
        this.inFlight.delete(key);
        throw error;
      }
    );
    this.inFlight.set(key, promise);
    return promise;
  }

  getSettings() {
    return this.settings.getAppSettings();
  }

  updateSettings(patch: Partial<AppSettings> & { deepseekApiKey?: string }) {
    return this.settings.updateSettings(patch);
  }

  async getCurrentOnboarding() {
    return this.modules.conversation.getCurrentGoalIntake();
  }

  sendOnboardingMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new CategorizedError('user_input_error', '访谈内容不能为空。');
    }
    return this.coalesce(
      `onboarding:${trimmed}`,
      () => this.modules.conversation.sendGoalIntakeMessage(trimmed)
    );
  }

  async cancelOnboardingQuestion() {
    return this.modules.conversation.cancelGoalIntakeQuestion();
  }

  async confirmOnboardingGoal(briefPatch?: Partial<GoalBrief>) {
    return this.modules.conversation.confirmGoalIntake(briefPatch);
  }

  listHistory() {
    return this.store.listGoalIntakes();
  }

  getHistoryIntake(intakeId: Id) {
    return this.store.getGoalIntakeById(intakeId);
  }

  async generateLayeredPlan(goalId: Id) {
    return this.modules.planning.generateLayeredPlan(goalId);
  }

  async confirmLearningGuide(guideId: Id) {
    const existing = await this.store.getDailyGuideById(guideId);
    if (existing && existing.status === 'confirmed') {
      return existing;
    }
    return this.store.confirmLearningGuide(guideId);
  }

  async resetLearningWorkspace() {
    const active = await this.getActiveSession();
    if (active?.session.status === 'active') {
      const paused = await this.modules.runtime.pauseSession(active.session.id);
      await this.pushSessionState(paused);
    }
    return this.store.archiveActiveGoalsAndRestart();
  }

  async startNextSession(goalId?: Id): Promise<StartNextSessionResult> {
    return this.modules.planning.advanceLearningDay(
      { goalId },
      {
        startAgentTurn: <TInput, TOutput>(params: {
          toolName: AgentToolName;
          input: TInput;
          context: AgentContext;
          audit: AgentRunAudit;
        }) => this.modules.learningTurn.startTool<TInput, TOutput>(params),
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
    return this.modules.review.generateForGuide(guideId);
  }

  async generateReview(date: string) {
    return this.modules.review.generateCurrent(date);
  }

  async getPreparationState(): Promise<LearningPreparationState> {
    const today = await this.store.getActiveGuide();
    if (!today.goal) return 'needs_goal';

    const goalId = today.goal.id;
    if (this.modules.planning.isPreparing(goalId)) return 'generating';
    const usedNearTermPlanItemIds = await this.store.getUsedNearTermPlanItemIds(goalId);
    const hasRecoverablePlanDay = today.shortPlan.some((day) =>
      day.sessionStatus === 'active' && !usedNearTermPlanItemIds.has(day.id)
    );

    const hasAvailablePlanDay = today.shortPlan.some((day) =>
      day.sessionStatus === 'pending' &&
      !usedNearTermPlanItemIds.has(day.id)
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

  async prepareCurrentLearningUnit(forceRetry = false): Promise<PrepareCurrentLearningUnitResult> {
    return this.modules.planning.prepareCurrentLearningUnit(
      { forceRetry },
      {
        startAgentTurn: <TInput, TOutput>(params: {
          toolName: AgentToolName;
          input: TInput;
          context: AgentContext;
          audit: AgentRunAudit;
        }) => this.modules.learningTurn.startTool<TInput, TOutput>(params),
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
        startAgentTurn: <TInput, TOutput>(params: {
          toolName: AgentToolName;
          input: TInput;
          context: AgentContext;
          audit: AgentRunAudit;
        }) => this.modules.learningTurn.startTool<TInput, TOutput>(params),
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

  async getOverview(): Promise<LearningOverviewState> {
    const [today, preparationState, context] = await Promise.all([
      this.store.getActiveGuide(),
      this.getPreparationState(),
      this.store.getCurrentLearningContext()
    ]);
    const pendingEvaluations = today.goal
      ? await this.store.getPendingEvaluationIdsForGoal(today.goal.id)
      : [];
    const currentStage = today.roadmap.find((stage) => stage.id === context.stageId)
      ?? today.roadmap.find((stage) =>
        stage.status === 'active' || stage.status === 'ready_for_review'
      )
      ?? null;
    return {
      ...today,
      currentStage,
      goalProgress: deriveGoalProgress(
        today.goal,
        today.roadmap,
        currentStage,
        todayIso()
      ),
      stageConflict: context.stageConflict,
      preparationState,
      pendingEvaluations
    };
  }

  getLatestReview(date?: string): Promise<ReviewResult | null> {
    return this.store.getLatestReview(date);
  }

  getKnowledgeItemsForGoal(params: { goalId: string; status?: KnowledgeItemStatus; limit?: number }): Promise<KnowledgeItem[]> {
    return this.store.getKnowledgeItemsForGoal(params);
  }

  setKnowledgeItemStatus(itemId: Id, status: KnowledgeItemStatus): Promise<KnowledgeItem> {
    if (!['active', 'resolved', 'dormant'].includes(status)) {
      throw new CategorizedError('user_input_error', '知识判断状态无效。');
    }
    return this.store.setKnowledgeItemStatus(itemId, status);
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
    this.getMainWindow()?.flashFrame(true);
    await this.pushSessionState(session);
    return session;
  }

  async pauseSession(sessionId: Id) {
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
    const snapshot = await this.modules.runtime.getSnapshot();
    const action = snapshot.dailyGuideAction;
    if (!action) {
      throw new CategorizedError(
        'validation_error',
        '当前没有可展开的学习步骤。请先进入一个可执行的学习任务。'
      );
    }
    const turn = await this.modules.learningTurn.start({
      intent: 'continue_teaching',
      promptProfileId
    });
    return {
      runId: turn.runId,
      action,
      artifacts: turn.artifacts,
      contextSourceIds: turn.contextSourceIds,
      pendingInteraction: turn.pendingInteraction
    };
  }

  async resumeLearningTurn(
    pendingInteractionId: Id,
    answer: string,
    expectedContextVersion: number
  ) {
    const trimmed = answer.trim();
    if (!trimmed) {
      throw new CategorizedError('user_input_error', '回答不能为空。');
    }
    const snapshot = await this.modules.runtime.getSnapshot();
    const action = snapshot.dailyGuideAction;
    if (!action) {
      throw new CategorizedError(
        'validation_error',
        '当前学习步骤已经变化，原问题没有被自动套用。'
      );
    }
    const turn = await this.modules.learningTurn.resume({
      intent: 'continue_teaching',
      pendingInteractionId,
      answer: trimmed,
      expectedContextVersion
    });
    return {
      runId: turn.runId,
      action,
      artifacts: turn.artifacts,
      contextSourceIds: turn.contextSourceIds,
      pendingInteraction: turn.pendingInteraction
    };
  }

  cancelLearningTurn(pendingInteractionId: Id) {
    return this.modules.learningTurn.cancel(pendingInteractionId);
  }

  completeCurrentAction() {
    return this.modules.runtime.dispatch({ type: 'completeCurrentAction' });
  }

  skipCurrentAction() {
    return this.modules.runtime.dispatch({ type: 'skipCurrentAction' });
  }

  async closeCurrentTask(input: CloseTaskInput) {
    let snapshot = await this.modules.runtime.dispatch({ type: 'closeCurrentTask', input });
    if (!snapshot.dailyGuideTask) {
      const prepared = await this.modules.planning.advanceLearningDay(
        {},
        {
          startAgentTurn: <TInput, TOutput>(params: {
            toolName: AgentToolName;
            input: TInput;
            context: AgentContext;
            audit: AgentRunAudit;
          }) => this.modules.learningTurn.startTool<TInput, TOutput>(params),
          getRuntimeSettings: () => this.settings.getRuntimeSettings(),
          createTraceId,
          todayIso,
          generateReview: (guideId) => this.generateReviewForClosedGuide(guideId)
        }
      );
      if (prepared.preparationState === 'active') {
        await this.store.auditRuntimeConsistency();
        snapshot = await this.modules.runtime.getSnapshot();
      } else if (prepared.preparationState === 'generation_failed') {
        throw new CategorizedError(
          'validation_error',
          `当前 Task 已收口并保存在记录中，但下一学习单元生成失败：${prepared.errorMessage ?? '请重试生成。'}`
        );
      } else if (prepared.preparationState === 'generating') {
        throw new CategorizedError('validation_error', '当前 Task 已收口，下一学习单元正在生成，请稍后重新检查。');
      }
    }
    return snapshot;
  }

  async terminateLearning() {
    const snapshot = await this.modules.runtime.dispatch({ type: 'endCurrentSession' });
    return snapshot;
  }

  askStepQuestion(question: string, promptProfileId?: Id) {
    const trimmed = question.trim();
    if (!trimmed) {
      throw new CategorizedError('user_input_error', '问题不能为空。');
    }
    const actionId = this.store.getActiveStepId() ?? 'none';
    return this.coalesce(
      `question:${actionId}:${trimmed}`,
      () => this.modules.conversation.askCurrent(trimmed, promptProfileId)
    );
  }

  askTemporaryQuestion(question: string, promptProfileId?: Id, threadId?: Id) {
    const trimmed = question.trim();
    if (!trimmed) throw new CategorizedError('user_input_error', '问题不能为空。');
    return this.coalesce(
      `temporary-question:${threadId ?? 'new'}:${trimmed}`,
      () => this.modules.conversation.askTemporary(trimmed, promptProfileId, threadId)
    );
  }

  getLatestTemporaryQuestion() {
    return this.modules.conversation.getLatestTemporary();
  }

  linkTemporaryQuestionToGoal(threadId: Id, goalId: Id) {
    return this.modules.conversation.linkTemporaryToGoal(threadId, goalId);
  }

  keepTemporaryQuestion(threadId: Id) {
    return this.modules.conversation.keepTemporary(threadId);
  }

  convertTemporaryQuestionToTask(threadId: Id, goalId: Id) {
    return this.modules.conversation.convertTemporaryToTask(threadId, goalId);
  }

  listGoals() {
    return this.store.listGoals();
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
    return this.coalesce(
      `submit:${actionId}:${trimmed}`,
      () => this._submitLearningResult(trimmed, promptProfileId)
    );
  }

  private async _submitLearningResult(content: string, promptProfileId?: Id) {
    const before = await this.store.getLearningRuntimeSnapshot();
    if (!before.dailyGuideTask) {
      throw new Error('当前没有可提交结果的 Task。');
    }
    const active = await this.getActiveSession();
    const submission = await this.store.createSubmission(before.dailyGuideTask.id, active?.session.id ?? null, content);
    if (active?.session.status === 'active') {
      const paused = await this.store.pauseSession(active.session.id);
      await this.pushSessionState(paused);
    }
    return this.modules.evaluation.evaluate(submission, promptProfileId);
  }

  async endSession(sessionId: Id) {
    const session = await this.modules.runtime.completeSession(sessionId);
    return session;
  }

  decideEvaluationRecommendation(
    evaluationId: Id,
    decision: 'accepted' | 'declined' | 'deferred',
    reason?: string
  ) {
    return this.store.decideEvaluationRecommendation(evaluationId, decision, reason);
  }

  recordEvaluationCorrection(evaluationId: Id, reason: string) {
    return this.store.recordEvaluationCorrection(evaluationId, reason);
  }

  retrySubmissionEvaluation(submissionId: Id, promptProfileId?: Id) {
    return this.coalesce(
      `retry-evaluation:${submissionId}`,
      () => this.modules.evaluation.retry(submissionId, promptProfileId)
    );
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
