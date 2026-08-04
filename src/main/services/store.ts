import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type {
  DailyGuide,
  DailyGuideAction,
  DailyGuideTask,
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeState,
  LearningEvaluation,
  LearningGoal,
  LearningRuntimeSnapshot,
  LearningSubmission,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PreviousLearningUnitResult,
  PromptProfile,
  QuestionMessage,
  QuestionThread,
  ReviewResult,
  RoadmapStage,
  NearTermPlanItem,
  StoredNextStepDecision,
  StudySession,
  StudyWindow,
} from '../../shared/types';
import type {
  AnswerStepQuestionAgentOutput,
  DailyGuideAgentOutput,
  GoalIntakeAgentOutput,
  NextStepDecisionAgentOutput,
  RoadmapAgentOutput,
  ShortPlanAgentOutput,
  SubmissionEvaluationAgentOutput,
  TeachStepAgentOutput
} from '../../shared/schemas';
import type { Database } from '../db/client';
import type {
  CreatePendingInteractionInput,
  PendingAgentInteraction,
  SaveAiReviewInput,
  UpdateAiReviewInput
} from '../agent/agent-types';
import type { LearningAiOperation, BuiltLearningContext } from './context-builder';
export type { LearningAiOperation, BuiltLearningContext };
import {
  aiReviews,
  goals,
  learningActions,
  learningEvaluations,
  learningGuides,
  learningSubmissions,
  learningTasks,
  roadmapStages,
} from '../db/schema';
import { createId, nowIso } from './id';
import { EvaluationPersistence } from './store/evaluation-persistence';
import { DailyGuidePersistence } from './store/daily-guide-persistence';
import { GoalIntakePersistence } from './store/goal-intake-persistence';
import { KnowledgeStore } from './store/knowledge-store';
import { LayeredPlanPersistence } from './store/layered-plan-persistence';
import { OpsPersistence } from './store/ops-persistence';
import type { AiProviderDiagnostic } from './store/ops-persistence';
import { PlanChangePersistence } from './store/plan-change-persistence';
import { RecommendationCommandGateway } from './store/recommendation-command-gateway';
import { ConversationPersistence } from './store/conversation-persistence';
import { ReportingPersistence } from './store/reporting-persistence';
import { RuntimePersistence } from './store/runtime-persistence';
import { CurrentLearningContextPersistence } from './store/current-learning-context';
import {
  mapDailyGuideAction,
  mapDailyGuideTask,
  mapGoal,
  mapRoadmapStage,
} from './store/serialization';

export class StudyStore extends KnowledgeStore {
  private readonly currentLearningContext: CurrentLearningContextPersistence;
  private readonly runtime: RuntimePersistence;
  private readonly evaluations: EvaluationPersistence;
  private readonly goalIntakes: GoalIntakePersistence;
  private readonly dailyGuidesStore: DailyGuidePersistence;
  private readonly planChanges: PlanChangePersistence;
  private readonly recommendations: RecommendationCommandGateway;
  private readonly conversations: ConversationPersistence;
  private readonly ops: OpsPersistence;
  private readonly layeredPlans: LayeredPlanPersistence;
  private readonly reporting: ReportingPersistence;

  constructor(db: Database) {
    super(db);
    this.currentLearningContext = new CurrentLearningContextPersistence(db);
    this.runtime = new RuntimePersistence(db, this.currentLearningContext);
    this.evaluations = new EvaluationPersistence(db, this.runtime);
    this.goalIntakes = new GoalIntakePersistence(
      db,
      this.currentLearningContext
    );
    this.dailyGuidesStore = new DailyGuidePersistence(db, this.currentLearningContext);
    this.planChanges = new PlanChangePersistence(db);
    this.recommendations = new RecommendationCommandGateway(db, this.runtime, this.planChanges);
    this.conversations = new ConversationPersistence(db, this.runtime);
    this.ops = new OpsPersistence(db);
    this.layeredPlans = new LayeredPlanPersistence(db, (guideId) => this.getDailyGuideById(guideId));
    this.reporting = new ReportingPersistence(
      db,
      (guideId) => this.getDailyGuideById(guideId)
    );
  }

  getActiveStepId(): string | null {
    return this.runtime.getActiveStepId();
  }

  async seedDefaults(): Promise<void> {
    await this.ops.seedDefaults();
  }

  async getSetting(key: string): Promise<string | null> {
    return this.ops.getSetting(key);
  }

  async putSetting(key: string, value: string): Promise<void> {
    await this.ops.putSetting(key, value);
  }

  getLatestAiProviderDiagnostic(params: {
    goalId?: string;
    kinds?: string[];
  } = {}): Promise<AiProviderDiagnostic | null> {
    return this.ops.getLatestAiProviderDiagnostic(params);
  }

  async createGoal(title: string, description?: string): Promise<LearningGoal> {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('学习目标标题不能为空。');
    const now = nowIso();
    const row = {
      id: createId('goal'),
      title: cleanTitle,
      description: description?.trim() || null,
      status: 'active' as const,
      priority: 3,
      dueDate: null,
      createdAt: now,
      updatedAt: now
    };
    await this.db.transaction(async (tx) => {
      await tx.insert(goals).values(row);
      await this.currentLearningContext.writeInTransaction(tx, {
        goalId: row.id,
        guideId: null,
        taskId: null,
        actionId: null
      });
    });
    return mapGoal(row);
  }

  async listGoals(): Promise<LearningGoal[]> {
    const rows = await this.db.select().from(goals).orderBy(desc(goals.createdAt));
    return rows.map(mapGoal);
  }

  async getGoal(goalId: string): Promise<LearningGoal | null> {
    const rows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    return rows[0] ? mapGoal(rows[0]) : null;
  }

  async getCurrentGoalIntake(): Promise<GoalIntakeState> {
    return this.goalIntakes.getCurrentGoalIntake();
  }

  async addGoalIntakeMessage(intakeId: string, role: GoalIntakeMessage['role'], content: string): Promise<GoalIntakeMessage> {
    return this.goalIntakes.addGoalIntakeMessage(intakeId, role, content);
  }

  async saveGoalIntakeAgentOutput(intakeId: string, output: GoalIntakeAgentOutput): Promise<GoalIntakeState> {
    return this.goalIntakes.saveGoalIntakeAgentOutput(intakeId, output);
  }

  async confirmGoalIntake(briefPatch: Partial<GoalBrief> = {}): Promise<{ goal: LearningGoal; intake: GoalIntake }> {
    return this.goalIntakes.confirmGoalIntake(briefPatch);
  }

  async getGoalBriefForGoal(goalId: string): Promise<GoalBrief | null> {
    return this.goalIntakes.getGoalBriefForGoal(goalId);
  }

  async saveLayeredPlan(params: {
    goal: LearningGoal;
    brief: GoalBrief | null;
    date: string;
    windows: StudyWindow[];
    roadmap: RoadmapAgentOutput;
    shortPlan: ShortPlanAgentOutput;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: NearTermPlanItem[]; guide: DailyGuide }> {
    return this.layeredPlans.saveLayeredPlan(params);
  }

  async findActiveOrActivateStage(goalId: string): Promise<RoadmapStage | 'goal_completed' | 'stage_review_required' | null> {
    return this.layeredPlans.findActiveOrActivateStage(goalId);
  }

  async saveRollingPlanDays(params: {
    goalId: string;
    roadmapStageId: string;
    items: Array<{
      itemIndex: number;
      title: string;
      focus: string;
      tasks: string[];
      expectedOutput: string;
      successCriteria: string;
    }>;
  }): Promise<NearTermPlanItem[]> {
    return this.layeredPlans.saveRollingPlanDays(params);
  }

  async auditRuntimeConsistency(): Promise<{
    consistent: boolean;
    fixed: string[];
  }> {
    return this.currentLearningContext.repair();
  }

  listCurrentGuideChoices() {
    return this.currentLearningContext.listGuideChoices();
  }

  listResumableGuides() {
    return this.runtime.listResumableGuides();
  }

  restoreArchivedGuide(guideId: string): Promise<LearningRuntimeSnapshot> {
    return this.runtime.restoreArchivedGuide(guideId);
  }



  selectCurrentGuide(guideId: string): Promise<void> {
    return this.currentLearningContext.selectCurrentGuide(guideId);
  }

  async getTokenCostStats(opts: { goalId?: string; operation?: string; fromDate?: string; toDate?: string }): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCalls: number;
    byOperation: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
    byDate: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
  }> {
    return this.ops.getTokenCostStats(opts);
  }

  async confirmLearningGuide(guideId: string): Promise<DailyGuide> {
    return this.dailyGuidesStore.confirmLearningGuide(guideId);
  }

  async archiveActiveGoalsAndRestart(): Promise<GoalIntakeState> {
    return this.goalIntakes.archiveActiveGoalsAndRestart();
  }

  async getUsedNearTermPlanItemIds(goalId: string): Promise<Set<string>> {
    return this.dailyGuidesStore.getUsedNearTermPlanItemIds(goalId);
  }

  async listAvailableNearTermPlanItemsForStage(goalId: string, roadmapStageId: string): Promise<NearTermPlanItem[]> {
    return this.dailyGuidesStore.listAvailableNearTermPlanItemsForStage(goalId, roadmapStageId);
  }

  async getPreviousCompletedLearningDayContext(
    goalId: string
  ): Promise<PreviousLearningUnitResult | null> {
    const latestClosed = await this.getLatestClosedGuideContext(goalId);
    if (!latestClosed) return null;
    const { guide, reviewSummary } = latestClosed;

    const tasks = await this.db
      .select()
      .from(learningTasks)
      .where(eq(learningTasks.guideId, guide.id))
      .orderBy(asc(learningTasks.position));

    const completedTasks = tasks.filter((t) => t.closureKind === 'completed').map((t) => t.title);
    if (completedTasks.length === 0) return null;

    const submissionResults = await this.getLastSubmissionEvaluationForGuide(guide);
    const evaluationSummary = submissionResults ?? '已完成';

    return { completedTasks, evaluationSummary, reviewSummary };
  }

  async getRollingPlanContext(goalId: string): Promise<{ summary: string; reviewSummary?: string } | null> {
    const latestClosed = await this.getLatestClosedGuideContext(goalId);
    if (!latestClosed) return null;
    const { taskTitles, doneTaskTitles, reviewSummary } = latestClosed;

    const summary = doneTaskTitles.length > 0
      ? `已完成任务：${doneTaskTitles.join('、')}。全部任务：${taskTitles.join('、')}。`
      : '暂无已完成任务。';

    return { summary, reviewSummary };
  }

  private async getLatestClosedGuideContext(goalId: string): Promise<{
    guide: typeof learningGuides.$inferSelect;
    taskTitles: string[];
    doneTaskTitles: string[];
    reviewSummary?: string;
  } | null> {
    const guideRows = await this.db
      .select()
      .from(learningGuides)
      .where(and(
        eq(learningGuides.goalId, goalId),
        eq(learningGuides.status, 'closed')
      ))
      .orderBy(desc(learningGuides.createdAt))
      .limit(1);
    if (guideRows.length === 0) return null;

    const guide = guideRows[0];
    const taskRows = await this.db
      .select({ title: learningTasks.title, closureKind: learningTasks.closureKind })
      .from(learningTasks)
      .where(eq(learningTasks.guideId, guide.id));

    const taskTitles = taskRows.map((t) => t.title);
    const doneTaskTitles = taskRows.filter((t) => t.closureKind === 'completed').map((t) => t.title);

    let reviewSummary: string | undefined;
    const reviewRows = await this.db
      .select()
      .from(aiReviews)
      .where(and(
        eq(aiReviews.kind, 'reflection'),
        inArray(aiReviews.status, ['success', 'completed'])
      ))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1);
    if (reviewRows.length > 0) {
      try {
        const output = JSON.parse(reviewRows[0].outputJson);
        reviewSummary = output.summary ?? undefined;
      } catch { /* ignore parse errors */ }
    }

    return { guide, taskTitles, doneTaskTitles, reviewSummary };
  }

  async getLastSubmissionEvaluationForGuide(guide: typeof learningGuides.$inferSelect): Promise<string | null> {
    const taskRows = await this.db.select({ id: learningTasks.id }).from(learningTasks)
      .where(eq(learningTasks.guideId, guide.id));
    if (taskRows.length === 0) return null;
    const submissions = await this.db.select({ id: learningSubmissions.id }).from(learningSubmissions)
      .where(inArray(learningSubmissions.taskId, taskRows.map((item) => item.id)));
    if (submissions.length === 0) return null;
    const evalRows = await this.db
      .select()
      .from(learningEvaluations)
      .where(inArray(learningEvaluations.submissionId, submissions.map((item) => item.id)))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    if (evalRows.length > 0) {
      return evalRows[0].feedback;
    }
    return null;
  }

  async ensureDraftDailyGuide(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    nearTermPlanItemId: string;
  }): Promise<DailyGuide> {
    return this.dailyGuidesStore.ensureDraftDailyGuide(params);
  }

  async saveDailyGuideWithTransaction(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    nearTermPlanItemId: string;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: NearTermPlanItem[]; guide: DailyGuide }> {
    return this.dailyGuidesStore.saveDailyGuideWithTransaction(params);
  }

  async getPendingEvaluationIdsForGoal(goalId: string): Promise<string[]> {
    return this.evaluations.getPendingEvaluationIdsForGoal(goalId);
  }

  async getActiveGuide(activeOnly: boolean = false): Promise<{ goal: LearningGoal | null; roadmap: RoadmapStage[]; shortPlan: NearTermPlanItem[]; guide: DailyGuide | null }> {
    return this.dailyGuidesStore.getActiveGuide(activeOnly);
  }

  async getGuideByDate(date: string): Promise<DailyGuide | null> {
    return this.dailyGuidesStore.getGuideByDate(date);
  }

  async activateNearTermPlanItem(nearTermPlanItemId: string): Promise<boolean> {
    return this.dailyGuidesStore.activateNearTermPlanItem(nearTermPlanItemId);
  }

  async getActiveStageForGoal(goalId: string): Promise<RoadmapStage | null> {
    const rows = await this.db
      .select()
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position))
      .limit(1);
    return rows[0] ? mapRoadmapStage(rows[0]) : null;
  }

  async getPendingNearTermPlanItemsForGoal(goalId: string): Promise<NearTermPlanItem[]> {
    return this.dailyGuidesStore.getPendingNearTermPlanItemsForGoal(goalId);
  }

  async getCompletedGuidesForGoal(goalId: string): Promise<DailyGuide[]> {
    return this.dailyGuidesStore.getCompletedGuidesForGoal(goalId);
  }

  createTaskFromTemporary(
    threadId: string,
    goalId: string
  ): Promise<{ taskId: string; guideId: string | null }> {
    return this.conversations.createTaskFromTemporary(threadId, goalId);
  }

  async getDailyGuideTaskByBlockId(blockId: string): Promise<DailyGuideTask | null> {
    const tasks = await this.getDailyGuideTasksByBlockId(blockId);
    return tasks.find((task) => task.id === blockId) ?? null;
  }

  async startSession(taskId: string): Promise<StudySession> {
    return this.runtime.startSession(taskId);
  }

  async pauseSession(sessionId: string): Promise<StudySession> {
    return this.runtime.pauseSession(sessionId);
  }

  async completeSession(sessionId: string, notes?: string): Promise<StudySession> {
    return this.runtime.completeSession(sessionId, notes);
  }

  async listSessions(): Promise<StudySession[]> {
    return this.runtime.listSessions();
  }

  async getCurrentLearningContext() {
    return this.currentLearningContext.resolve();
  }

  async getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot> {
    return this.runtime.getSnapshot();
  }

  async completeCurrentAction(actionId: string, note?: string): Promise<LearningRuntimeSnapshot> {
    return this.runtime.completeCurrentAction(actionId, note);
  }

  async skipCurrentAction(actionId: string): Promise<LearningRuntimeSnapshot> {
    return this.runtime.skipCurrentAction(actionId);
  }

  async closeTask(
    taskId: string,
    closureKind: 'completed' | 'partial' | 'abandoned' | 'replaced',
    closureReason?: string,
    nextStartPoint?: string
  ): Promise<void> {
    return this.runtime.closeTask(taskId, closureKind, closureReason, nextStartPoint);
  }

  insertGuideSupplement(params: {
    title: string;
    instruction: string;
    checkpoint: string;
    sourceAiReviewId: string;
    expectedContextVersion: number;
  }): Promise<DailyGuideAction> {
    return this.runtime.insertGuideSupplement(params);
  }

  async openQuestion(
    actionId: string | null,
    question: string,
    opts?: { goalId?: string; standalone?: boolean }
  ): Promise<QuestionThread> {
    return this.conversations.openQuestion(actionId, question, opts);
  }

  async addQuestionMessage(threadId: string, role: 'user' | 'assistant', content: string): Promise<QuestionMessage> {
    return this.conversations.addQuestionMessage(threadId, role, content);
  }

  async getQuestionMessages(threadId: string): Promise<QuestionMessage[]> {
    return this.conversations.getQuestionMessages(threadId);
  }

  getLatestStandaloneQuestionThread(): Promise<QuestionThread | null> {
    return this.conversations.getLatestStandaloneQuestionThread();
  }

  linkQuestionThreadToGoal(threadId: string, goalId: string): Promise<QuestionThread> {
    return this.conversations.linkQuestionThreadToGoal(threadId, goalId);
  }

  async saveQuestionAnswer(threadId: string, output: AnswerStepQuestionAgentOutput): Promise<QuestionThread> {
    return this.conversations.saveQuestionAnswer(threadId, output);
  }

  async resolveQuestion(threadId: string, summary?: string): Promise<void> {
    await this.conversations.resolveQuestion(threadId, summary);
  }

  async createSubmission(params: {
    taskId: string;
    stepId?: string | null;
    sessionId?: string | null;
    content: string;
  }): Promise<LearningSubmission> {
    return this.evaluations.createSubmission(params);
  }

  async getSubmissionById(submissionId: string): Promise<LearningSubmission | null> {
    return this.evaluations.getSubmissionById(submissionId);
  }

  async markEvaluationEvaluating(submissionId: string): Promise<void> {
    return this.evaluations.markEvaluationEvaluating(submissionId);
  }

  async markEvaluationCompleted(submissionId: string): Promise<void> {
    return this.evaluations.markEvaluationCompleted(submissionId);
  }

  async markEvaluationFailed(submissionId: string, errorMessage: string): Promise<void> {
    return this.evaluations.markEvaluationFailed(submissionId, errorMessage);
  }

  async getSubmissionsNeedingEvaluation(): Promise<string[]> {
    return this.evaluations.getSubmissionsNeedingEvaluation();
  }

  async acquireGenerationLock(lockKey: string, ttlMs: number = 120_000): Promise<boolean> {
    return this.ops.acquireGenerationLock(lockKey, ttlMs);
  }

  async releaseGenerationLock(lockKey: string): Promise<void> {
    await this.ops.releaseGenerationLock(lockKey);
  }

  async saveEvaluationAndDecision(params: {
    submission: LearningSubmission;
    evaluationOutput: SubmissionEvaluationAgentOutput;
    direction: LearningEvaluation['decision'];
    decisionOutput: NextStepDecisionAgentOutput;
    evaluationAiReviewId?: string;
    decisionAiReviewId?: string;
  }): Promise<{ evaluation: LearningEvaluation; decision: StoredNextStepDecision; nextAction: DailyGuideAction | null }> {
    return this.evaluations.saveEvaluationAndDecision(params);
  }

  async recordEvaluationCorrection(
    evaluationId: string,
    reason: string
  ): Promise<LearningRuntimeSnapshot> {
    const correction = await this.evaluations.recordCorrection(evaluationId, reason);
    await this.recordKnowledgeItems({
      goalId: correction.goalId,
      items: [{
        key: `evaluation-correction:${evaluationId}`,
        summary: correction.evaluation.feedback,
        detail: reason.trim(),
        sourceType: 'correction',
        sourceId: correction.evaluation.id,
        evidence: {
          submissionId: correction.submissionId,
          evaluationId: correction.evaluation.id
        }
      }]
    });
    return this.runtime.getSnapshot();
  }

  /**
   * 崩溃恢复：查找 evaluation 已保存（taskCompleted=true）但 task 未完成的 submission，幂等推进。
   * 在 AppService.initialize() 启动时调用。
   */


  async getPlanAdjustmentProposal(proposalId: string): Promise<PlanAdjustmentProposal | null> {
    return this.planChanges.getPlanAdjustmentProposal(proposalId);
  }

  async getSubmissionsForTask(taskId: string): Promise<LearningSubmission[]> {
    return this.evaluations.getSubmissionsForTask(taskId);
  }

  async getEvaluationsForTask(taskId: string): Promise<LearningEvaluation[]> {
    return this.evaluations.getEvaluationsForTask(taskId);
  }

  /** 当阶段内的学习单元全部完成时，只进入待复核，不自动宣告能力达成。 */
  async markRoadmapStageReadyForReview(goalId: string): Promise<void> {
    return this.planChanges.markRoadmapStageReadyForReview(goalId);
  }

  async confirmRoadmapStageCompletion(goalId: string, stageId: string): Promise<RoadmapStage[]> {
    return this.planChanges.confirmRoadmapStageCompletion(goalId, stageId);
  }

  async buildContext(operation: LearningAiOperation, extra: Record<string, unknown> = {}): Promise<BuiltLearningContext> {
    const { ContextBuilder } = await import('./context-builder');
    const builder = new ContextBuilder(this);
    return builder.build(operation, extra);
  }

  async exportGoalData(goalId: string): Promise<Record<string, unknown>> {
    return this.reporting.exportGoalData(goalId);
  }

  async listPlanAdjustmentProposals(status?: PlanAdjustmentProposal['status']): Promise<PlanAdjustmentProposal[]> {
    return this.planChanges.listPlanAdjustmentProposals(status);
  }

  async decidePlanAdjustment(proposalId: string, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> {
    return this.recommendations.decideGoalReview(proposalId, status);
  }

  async getPlanVersionsForGoal(goalId: string): Promise<PlanVersionEntry[]> {
    return this.planChanges.getPlanVersionsForGoal(goalId);
  }

  async createProposal(goalId: string, proposal: PlanProposalInput): Promise<PlanAdjustmentProposal> {
    return this.planChanges.createProposal(goalId, proposal);
  }

  async confirmProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    return this.recommendations.decideGoalReview(proposalId, 'accepted');
  }

  async decideEvaluationRecommendation(
    evaluationId: string,
    decision: 'accepted' | 'declined' | 'deferred',
    reason?: string
  ): Promise<LearningRuntimeSnapshot> {
    return this.recommendations.decideSubmissionRecommendation(evaluationId, decision, reason);
  }

  async getDailyGuideById(guideId: string): Promise<DailyGuide | null> {
    return this.dailyGuidesStore.getDailyGuideById(guideId);
  }

  private async getDailyGuideTasksByBlockId(blockId: string): Promise<DailyGuideTask[]> {
    const taskRows = await this.db
      .select()
      .from(learningTasks)
      .where(eq(learningTasks.id, blockId))
      .limit(1);
    const currentTask = taskRows[0];
    if (!currentTask) return [];

    const guideTaskRows = await this.db
      .select()
      .from(learningTasks)
      .where(currentTask.guideId
        ? eq(learningTasks.guideId, currentTask.guideId)
        : isNull(learningTasks.guideId))
      .orderBy(asc(learningTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of guideTaskRows) {
      const actionRows = await this.db
        .select()
        .from(learningActions)
        .where(eq(learningActions.taskId, task.id))
        .orderBy(asc(learningActions.position));
      tasks.push(mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction)));
    }
    return tasks;
  }

  async getQuestionThread(threadId: string): Promise<QuestionThread | null> {
    return this.conversations.getQuestionThread(threadId);
  }

  async getPromptProfile(profileId?: string): Promise<PromptProfile> {
    return this.ops.getPromptProfile(profileId);
  }

  async saveAiReview(params: SaveAiReviewInput): Promise<string> {
    return this.ops.saveAiReview(params);
  }

  updateAiReview(id: string, patch: UpdateAiReviewInput): Promise<void> {
    return this.ops.updateAiReview(id, patch);
  }

  getAgentRunState(id: string) {
    return this.ops.getAgentRunState(id);
  }

  getActiveAgentRun(scopeType: string, scopeId: string) {
    return this.ops.getActiveAgentRun(scopeType, scopeId);
  }

  getNextAgentToolSequence(runReviewId: string): Promise<number> {
    return this.ops.getNextAgentToolSequence(runReviewId);
  }

  createPendingInteraction(
    params: CreatePendingInteractionInput
  ): Promise<PendingAgentInteraction> {
    return this.ops.createPendingInteraction(params);
  }

  getPendingInteraction(id: string): Promise<PendingAgentInteraction | null> {
    return this.ops.getPendingInteraction(id);
  }

  getOpenPendingInteraction(
    scopeType: string,
    scopeId: string
  ): Promise<PendingAgentInteraction | null> {
    return this.ops.getOpenPendingInteraction(scopeType, scopeId);
  }

  answerPendingInteraction(
    id: string,
    answer: string,
    answerMessageRefId?: string
  ): Promise<boolean> {
    return this.ops.answerPendingInteraction(id, answer, answerMessageRefId);
  }

  cancelPendingInteraction(id: string): Promise<boolean> {
    return this.ops.cancelPendingInteraction(id);
  }

  skipPendingInteraction(id: string, answerMessageRefId?: string): Promise<boolean> {
    return this.ops.skipPendingInteraction(id, answerMessageRefId);
  }

  failInterruptedAgentRuns(): Promise<number> {
    return this.ops.failInterruptedAgentRuns();
  }

  async getLatestReview(date?: string): Promise<ReviewResult | null> {
    return this.ops.getLatestReview(date);
  }

  async getGuideSnapshot(guideId: string) {
    return this.reporting.getGuideSnapshot(guideId);
  }
}
