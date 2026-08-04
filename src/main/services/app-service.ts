import type { BrowserWindow } from 'electron';
import { ipcChannels } from '../../shared/ipc';
import { localDateIso } from '../../shared/date';

import { hasCompleteAiConfiguration } from '../../shared/types';
import type {
  AiProviderStatus,
  AppSettings,
  DailyGuideAction,
  GenerateRollingPlanResult,
  GoalBrief,
  Id,
  KnowledgeItem,
  KnowledgeItemStatus,
  LearnerFactScope,
  LearnerFactSource,
  LearningEvaluationNotification,
  LearningOverviewState,
  LearningPreparationState,
  LearningSubmission,
  LearningSubmissionResult,
  PlanProposalInput,
  PrepareCurrentLearningUnitResult,
  ReviewResult,
  RuntimeAuditResult,
  StudySession,
  UpdateAppSettingsInput
} from '../../shared/types';
import { AiClient } from '../ai/ai-client';
import { CategorizedError, describeError } from '../ai/categorized-error';
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
  private planPhase: string | null = null;
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
    this.modules.planning.setPhaseListener((phase) => {
      this.planPhase = phase;
    });
  }

  async initialize(): Promise<void> {
    await this.agentLoop.recoverInterruptedRuns();
    this.startupRuntimeAudit = await this.runRuntimeAudit();
    await this.advancePreviouslySubmittedTask();
    void this.recoverPendingEvaluations();
  }

  private async recoverPendingEvaluations(): Promise<void> {
    const pending = await this.store.getSubmissionsNeedingEvaluation();
    for (const submissionId of pending) {
      const submission = await this.store.getSubmissionById(submissionId);
      if (submission) {
        await this.evaluateInBackground(submission);
      }
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

  async getSettings(): Promise<AppSettings> {
    const settings = await this.settings.getAppSettings();
    return {
      ...settings,
      aiProviderStatus: await this.getAiProviderStatus(settings)
    };
  }

  async updateSettings(
    patch: UpdateAppSettingsInput
  ): Promise<AppSettings> {
    const before = await this.settings.getAppSettings();
    const updated = await this.settings.updateSettings(patch);
    const aiConfigChanged = (
      (typeof patch.aiBaseUrl === 'string'
        && patch.aiBaseUrl !== before.aiBaseUrl)
      || (typeof patch.aiModel === 'string'
        && patch.aiModel !== before.aiModel)
      || Boolean(patch.aiApiKey?.trim())
    );
    if (aiConfigChanged) {
      await this.store.putSetting('aiConfigUpdatedAt', new Date().toISOString());
    }
    return {
      ...updated,
      aiProviderStatus: await this.getAiProviderStatus(updated)
    };
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

  generateInitialLearningPlan(briefPatch?: Partial<GoalBrief>): Promise<LearningOverviewState> {
    return this.coalesce('initial-learning-plan', async () => {
      const current = await this.store.getActiveGuide();
      if (current.guide?.tasks.length) {
        return this.getOverview();
      }

      const { goal } = await this.modules.conversation.confirmGoalIntake(briefPatch);
      this.planPhase = '① 长期大纲';
      try {
        const plan = await this.modules.planning.generateLayeredPlan(goal.id);
        await this.modules.execution.confirmGuide(plan.guide.id);
      } finally {
        this.planPhase = null;
      }
      return this.getOverview();
    });
  }

  async confirmLearningGuide(guideId: Id) {
    return this.modules.execution.confirmGuide(guideId);
  }

  async resetLearningWorkspace() {
    const active = await this.getActiveSession();
    if (active) {
      await this.modules.execution.endSession(active.id);
    }
    return this.store.archiveActiveGoalsAndRestart();
  }

  async generateReview(date: string) {
    return this.modules.review.generateCurrent(date);
  }

  private async getAiProviderStatus(settings: AppSettings): Promise<AiProviderStatus> {
    if (!hasCompleteAiConfiguration(settings)) {
      const missing = [
        !settings.hasAiApiKey ? 'API Key' : '',
        !settings.aiBaseUrl.trim() ? '服务地址' : '',
        !settings.aiModel.trim() ? '模型名称' : ''
      ].filter(Boolean);
      return {
        state: 'unverified',
        checkedAt: null,
        model: settings.aiModel || null,
        errorCategory: 'missing_config',
        message: `AI 配置不完整：缺少${missing.join('、')}。`
      };
    }
    const [diagnostic, configUpdatedAt] = await Promise.all([
      this.store.getLatestAiProviderDiagnostic(),
      this.store.getSetting('aiConfigUpdatedAt')
    ]);
    const checkedAt = diagnostic?.completedAt ?? diagnostic?.createdAt ?? null;
    if (!diagnostic || (configUpdatedAt && (!checkedAt || checkedAt < configUpdatedAt))) {
      return {
        state: 'unverified',
        checkedAt: null,
        model: settings.aiModel,
        errorCategory: null,
        message: '配置已保存，将在下一次 AI 请求后更新连接状态。'
      };
    }
    if (diagnostic.status === 'completed') {
      return {
        state: 'available',
        checkedAt,
        model: diagnostic.model,
        errorCategory: null,
        message: '最近一次 AI 请求成功。'
      };
    }
    const described = describeError(diagnostic.errorMessage ?? 'AI 请求失败');
    const errorCategory = diagnostic.errorCategory ?? described.category;
    const isSchemaViolation = errorCategory === 'schema_violation'
      || described.category === 'schema_violation'
      || /结构不完整|格式校验|schema/i.test(diagnostic.errorMessage ?? '');
    if (isSchemaViolation) {
      return {
        state: 'available',
        checkedAt,
        model: diagnostic.model,
        errorCategory: 'schema_violation',
        message: 'AI 服务可连接，但最近一次业务输出未通过格式校验。'
      };
    }
    return {
      state: 'failed',
      checkedAt,
      model: diagnostic.model,
      errorCategory,
      message: described.message
    };
  }

  private async getPreparationStatus(
    today: Awaited<ReturnType<StudyStore['getActiveGuide']>>
  ): Promise<{ state: LearningPreparationState; errorMessage?: string }> {
    if (!today.goal) return { state: 'needs_goal' };

    const goalId = today.goal.id;
    if (this.modules.planning.isPreparing(goalId)) return { state: 'generating' };
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
      if (guide.sessionStatus === 'draft' && guide.tasks.length === 0) {
        const failure = await this.store.getLatestAiProviderDiagnostic({
          goalId,
          kinds: ['roadmap', 'short_plan', 'daily_guide']
        });
        return {
          state: 'generation_failed',
          errorMessage: failure?.errorMessage
            ?? '当前 Learning Guide 生成中断，目标和近期计划已保留。'
        };
      }
      if (guide.status === 'completed' || guide.sessionStatus === 'closed') {
        if (stageReviewRequired) return { state: 'stage_review_required' };
        return { state: hasAvailablePlanDay ? 'completed' : 'plan_exhausted' };
      }
      return { state: 'active' };
    }

    if (stageReviewRequired) return { state: 'stage_review_required' };
    if (!hasRecoverablePlanDay && !hasAvailablePlanDay) return { state: 'plan_exhausted' };

    return { state: 'ready_to_generate' };
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

  listResumableGuides() {
    return this.store.listResumableGuides();
  }

  async restoreArchivedGuide(guideId: Id) {
    return this.modules.execution.restoreArchivedGuide(guideId);
  }

  async getOverview(): Promise<LearningOverviewState> {
    const today = await this.store.getActiveGuide();
    const [preparation, context] = await Promise.all([
      this.getPreparationStatus(today),
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
      preparationState: preparation.state,
      errorMessage: preparation.errorMessage,
      pendingEvaluations,
      planPhase: this.planPhase
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
    const guideChoices = await this.store.listCurrentGuideChoices();
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      guideChoices
    };
  }

  async selectCurrentGuide(guideId: Id): Promise<RuntimeAuditResult> {
    this.startupRuntimeAudit = null;
    await this.store.selectCurrentGuide(guideId);
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

  async confirmRoadmapStage(goalId: Id, stageId: Id) {
    return this.modules.planning.confirmRoadmapStage(goalId, stageId);
  }

  async startSession(taskId: Id) {
    const session = await this.modules.execution.startSession(taskId);
    this.getMainWindow()?.flashFrame(true);
    await this.pushSessionState(session);
    return session;
  }

  async pauseSession(sessionId: Id) {
    const session = await this.modules.execution.pauseSession(sessionId);
    await this.pushSessionState(session);
    return session;
  }

  async getActiveSession(): Promise<StudySession | null> {
    return this.modules.execution.getActiveSession();
  }

  getLearningState() {
    return this.modules.execution.getState();
  }

  async teachCurrentStep(promptProfileId?: Id) {
    const actionId = this.store.getActiveStepId() ?? 'none';
    return this.coalesce(
      `teach:${actionId}`,
      async () => {
        const snapshot = await this.modules.execution.getState();
        const turn = await this.modules.learningTurn.start({
          intent: 'continue_teaching',
          promptProfileId
        });
        return {
          runId: turn.runId,
          action: snapshot.dailyGuideAction!,
          artifacts: turn.artifacts,
          contextSourceIds: turn.contextSourceIds,
          pendingInteraction: turn.pendingInteraction
        };
      }
    );
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
    const snapshot = await this.modules.execution.getState();
    const turn = await this.modules.learningTurn.resume({
      intent: 'continue_teaching',
      pendingInteractionId,
      answer: trimmed,
      expectedContextVersion
    });
    return {
      runId: turn.runId,
      action: snapshot.dailyGuideAction!,
      artifacts: turn.artifacts,
      contextSourceIds: turn.contextSourceIds,
      pendingInteraction: turn.pendingInteraction
    };
  }

  cancelLearningTurn(pendingInteractionId: Id) {
    return this.modules.learningTurn.cancel(pendingInteractionId);
  }

  completeCurrentAction(actionId: Id, note?: string) {
    return this.modules.execution.completeAction(actionId, note);
  }

  skipCurrentAction(actionId: Id) {
    return this.modules.execution.skipAction(actionId);
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
    const submission = await this.store.createSubmission({
      taskId: before.dailyGuideTask.id,
      stepId: before.dailyGuideAction?.id ?? null,
      sessionId: active?.id ?? null,
      content
    });
    if (active) {
      const ended = await this.modules.execution.endSession(active.id);
      await this.pushSessionState(ended);
    }
    await this.store.closeTask(
      before.dailyGuideTask.id,
      'completed',
      '用户已提交学习成果'
    );
    const result: LearningSubmissionResult = {
      submission,
      state: await this.store.getLearningRuntimeSnapshot()
    };
    void this.evaluateInBackground(submission, promptProfileId, true);
    return result;
  }

  async endSession(sessionId: Id) {
    const session = await this.modules.execution.endSession(sessionId);
    return session;
  }

  recordEvaluationCorrection(evaluationId: Id, reason: string) {
    return this.store.recordEvaluationCorrection(evaluationId, reason);
  }

  async decidePlanAdjustment(proposalId: Id, status: 'accepted' | 'rejected') {
    return this.store.decidePlanAdjustment(proposalId, status);
  }

  decideEvaluationRecommendation(
    evaluationId: Id,
    decision: 'accepted' | 'declined' | 'deferred',
    reason?: string
  ) {
    return this.store.decideEvaluationRecommendation(evaluationId, decision, reason);
  }

  async retrySubmissionEvaluation(submissionId: Id): Promise<LearningSubmission> {
    return this.coalesce(`evaluation:${submissionId}`, async () => {
      const submission = await this.store.getSubmissionById(submissionId);
      if (!submission) {
        throw new CategorizedError('user_input_error', '找不到要重试的学习成果。');
      }
      if (submission.evaluationStatus === 'completed') return submission;
      await this.runEvaluation(submission, undefined, true);
      return (await this.store.getSubmissionById(submissionId)) ?? submission;
    });
  }

  async pushSessionState(session: StudySession): Promise<void> {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(ipcChannels.sessionStateChanged, session);
    }
  }

  private async advancePreviouslySubmittedTask(): Promise<void> {
    const snapshot = await this.store.getLearningRuntimeSnapshot();
    if (!snapshot.dailyGuideTask || !snapshot.latestSubmission) return;
    const active = await this.getActiveSession();
    if (active?.taskId === snapshot.dailyGuideTask.id) {
      const ended = await this.modules.execution.endSession(active.id);
      await this.pushSessionState(ended);
    }
    await this.store.closeTask(
      snapshot.dailyGuideTask.id,
      'completed',
      '用户已提交学习成果'
    );
  }

  private async evaluateInBackground(
    submission: LearningSubmission,
    promptProfileId?: Id,
    triggeredByUser = false
  ): Promise<void> {
    return this.coalesce(
      `evaluation:${submission.id}`,
      () => this.runEvaluation(submission, promptProfileId, triggeredByUser)
    );
  }

  private async runEvaluation(
    submission: LearningSubmission,
    promptProfileId?: Id,
    triggeredByUser = false
  ): Promise<void> {
    await this.store.markEvaluationEvaluating(submission.id);
    let notification: LearningEvaluationNotification;
    try {
      const result = await this.modules.evaluation.evaluate(submission, promptProfileId);
      await this.store.markEvaluationCompleted(submission.id);
      notification = { status: 'completed', result, triggeredByUser };
    } catch (error) {
      const message = describeError(error).message;
      await this.store.markEvaluationFailed(submission.id, message);
      notification = { status: 'failed', submissionId: submission.id, message, triggeredByUser };
    }
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(ipcChannels.learningEvaluationFinished, notification);
    }
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
