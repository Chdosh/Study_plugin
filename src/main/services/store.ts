import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type {
  DailyPlanBlock,
  DailyGuide,
  DailyGuideAction,
  DailyGuideTask,
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningEvaluation,
  LearningGoal,
  LearningRuntimeSnapshot,
  LearningRuntimeState,
  LearningStep,
  LearningSubmission,
  LearningSummary,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PreviousLearningDayResult,
  PromptProfile,
  QuestionMessage,
  QuestionThread,
  ReviewResult,
  RoadmapStage,
  ShortPlanDay,
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
import { applyEvaluationResult } from '../domain/execution-state-machine';
import type { Database } from '../db/client';
import type { AiCallMetrics } from '../ai/ai-client';
import type { LearningAiOperation, BuiltLearningContext } from './context-builder';
export type { LearningAiOperation, BuiltLearningContext };
import {
  aiReviews,
  dailyGuideActions,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  goals,
  learningEvaluations,
  learningRuntimeStates,
  learningSteps,
  nextStepDecisions,
  roadmapStages,
  shortPlanDays,
  studySessions,
} from '../db/schema';
import { createId, nowIso } from './id';
import { EvaluationPersistence } from './store/evaluation-persistence';
import { DailyGuidePersistence } from './store/daily-guide-persistence';
import { GoalIntakePersistence } from './store/goal-intake-persistence';
import { KnowledgeStore } from './store/knowledge-store';
import { LayeredPlanPersistence } from './store/layered-plan-persistence';
import { OpsPersistence } from './store/ops-persistence';
import { PlanChangePersistence } from './store/plan-change-persistence';
import { QuestionBranchPersistence } from './store/question-branch-persistence';
import { ReportingPersistence } from './store/reporting-persistence';
import { RuntimePersistence } from './store/runtime-persistence';
import { CurrentLearningContextPersistence } from './store/current-learning-context';
import {
  mapDailyGuideAction,
  mapDailyGuideTask,
  mapDecision,
  mapGoal,
  mapPlanBlock,
  mapQuestionThread,
  mapRoadmapStage,
  parseStringArray,
} from './store/serialization';

export class StudyStore extends KnowledgeStore {
  private readonly currentLearningContext: CurrentLearningContextPersistence;
  private readonly runtime: RuntimePersistence;
  private readonly evaluations: EvaluationPersistence;
  private readonly goalIntakes: GoalIntakePersistence;
  private readonly dailyGuidesStore: DailyGuidePersistence;
  private readonly planChanges: PlanChangePersistence;
  private readonly questionBranches: QuestionBranchPersistence;
  private readonly ops: OpsPersistence;
  private readonly layeredPlans: LayeredPlanPersistence;
  private readonly reporting: ReportingPersistence;

  constructor(db: Database) {
    super(db);
    this.currentLearningContext = new CurrentLearningContextPersistence(db);
    this.runtime = new RuntimePersistence(db, this.currentLearningContext);
    this.evaluations = new EvaluationPersistence(db, this.runtime, (guideId) => this.completeLearningDay(guideId));
    this.goalIntakes = new GoalIntakePersistence(db, this.runtime);
    this.dailyGuidesStore = new DailyGuidePersistence(db, this.currentLearningContext);
    this.planChanges = new PlanChangePersistence(db);
    this.questionBranches = new QuestionBranchPersistence(db, this.runtime, (params) => this.recordKnowledgeItems(params));
    this.ops = new OpsPersistence(db);
    this.layeredPlans = new LayeredPlanPersistence(db, (guideId) => this.getDailyGuideById(guideId));
    this.reporting = new ReportingPersistence(db, (date) => this.getGuideByDate(date));
  }

  getActiveStepId(): string | null {
    return this.runtime.getActiveStepId();
  }

  getRuntimePersistence(): RuntimePersistence {
    return this.runtime;
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

  async createGoal(title: string, description?: string): Promise<LearningGoal> {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('学习目标标题不能为空。');
    const now = nowIso();
    const row = {
      id: createId('goal'),
      sourceImportId: null,
      title: cleanTitle,
      description: description?.trim() || null,
      status: 'active' as const,
      priority: 3,
      dueDate: null,
      createdAt: now,
      updatedAt: now
    };
    await this.db.insert(goals).values(row);
    await this.upsertRuntimeState({
      activeGoalId: row.id,
      activeStageId: null,
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle'
    });
    return row;
  }

  async listGoals(): Promise<LearningGoal[]> {
    const rows = await this.db.select().from(goals).orderBy(desc(goals.createdAt));
    return rows.map(mapGoal);
  }

  async getGoal(goalId: string): Promise<LearningGoal | null> {
    const rows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    return rows[0] ? mapGoal(rows[0]) : null;
  }

  async listGoalIntakes(): Promise<HistoryIntakeSummary[]> {
    return this.goalIntakes.listGoalIntakes();
  }

  async getGoalIntakeById(intakeId: string): Promise<GoalIntakeState> {
    return this.goalIntakes.getGoalIntakeById(intakeId);
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
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide }> {
    return this.layeredPlans.saveLayeredPlan(params);
  }

  async findActiveOrActivateStage(goalId: string): Promise<RoadmapStage | 'goal_completed' | 'stage_review_required' | null> {
    return this.layeredPlans.findActiveOrActivateStage(goalId);
  }

  async saveRollingPlanDays(params: {
    goalId: string;
    roadmapStageId: string;
    items: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      tasks: string[];
      expectedOutput: string;
      successCriteria: string;
    }>;
  }): Promise<ShortPlanDay[]> {
    return this.layeredPlans.saveRollingPlanDays(params);
  }

  async applyReviewPlanAdjustments(params: {
    goalId: string;
    adjustments: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
      reason: string;
    }>;
  }): Promise<ShortPlanDay[]> {
    return this.planChanges.applyReviewPlanAdjustments(params);
  }

  async auditRuntimeConsistency(): Promise<{
    consistent: boolean;
    fixed: string[];
    conflicts: Array<{ field: string; expected: string; actual: string }>;
  }> {
    return this.currentLearningContext.repair();
  }

  listCurrentGuideChoices() {
    return this.currentLearningContext.listGuideChoices();
  }

  listAmbiguousLearningUnits() {
    return this.currentLearningContext.listAmbiguousLearningUnits();
  }

  selectCurrentGuide(guideId: string): Promise<void> {
    return this.currentLearningContext.selectCurrentGuide(guideId);
  }

  resolveAmbiguousLearningUnit(guideId: string, decision: 'restore' | 'skip'): Promise<void> {
    return this.currentLearningContext.resolveAmbiguousLearningUnit(guideId, decision);
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

  async confirmDailyGuide(guideId: string): Promise<DailyGuide> {
    return this.dailyGuidesStore.confirmDailyGuide(guideId);
  }

  async archiveTodayGuides(date: string): Promise<GoalIntakeState> {
    return this.goalIntakes.archiveTodayGuides(date);
  }

  async getUsedShortPlanDayIds(goalId: string): Promise<Set<string>> {
    return this.dailyGuidesStore.getUsedShortPlanDayIds(goalId);
  }

  async listAvailableShortPlanDaysForStage(goalId: string, roadmapStageId: string): Promise<ShortPlanDay[]> {
    return this.dailyGuidesStore.listAvailableShortPlanDaysForStage(goalId, roadmapStageId);
  }

  async getPreviousCompletedLearningDayContext(
    goalId: string
  ): Promise<PreviousLearningDayResult | null> {
    const guideRows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(
        eq(dailyGuides.goalId, goalId),
        eq(dailyGuides.sessionStatus, 'closed')
      ))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    if (guideRows.length === 0) return null;

    const guide = guideRows[0];
    const tasks = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guide.id))
      .orderBy(asc(dailyGuideTasks.position));

    const completedTasks = tasks.filter((t) => t.status === 'done').map((t) => t.title);
    if (completedTasks.length === 0) return null;

    const submissionResults = await this.getLastSubmissionEvaluationForGuide(guide);
    const evaluationSummary = submissionResults ?? '已完成';

    let reviewSummary: string | undefined;
    const reviewRows = await this.db
      .select()
      .from(aiReviews)
      .where(and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.date, guide.date)))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1);
    if (reviewRows.length > 0 && reviewRows[0].status === 'success') {
      try {
        const output = JSON.parse(reviewRows[0].outputJson);
        reviewSummary = output.summary ?? undefined;
      } catch { /* ignore parse errors */ }
    }

    return { completedTasks, evaluationSummary, reviewSummary };
  }

  async getRollingPlanContext(goalId: string): Promise<{ summary: string; reviewSummary?: string } | null> {
    const guideRows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(
        eq(dailyGuides.goalId, goalId),
        eq(dailyGuides.sessionStatus, 'closed')
      ))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    if (guideRows.length === 0) return null;

    const guide = guideRows[0];
    const taskRows = await this.db
      .select({ title: dailyGuideTasks.title, status: dailyGuideTasks.status })
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guide.id));

    const doneTasks = taskRows.filter((t) => t.status === 'done').map((t) => t.title);
    const allTasks = taskRows.map((t) => t.title);
    const summary = doneTasks.length > 0
      ? `已完成任务：${doneTasks.join('、')}。全部任务：${allTasks.join('、')}。`
      : '暂无已完成任务。';

    let reviewSummary: string | undefined;
    const reviewRows = await this.db
      .select()
      .from(aiReviews)
      .where(and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.status, 'success')))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1);
    if (reviewRows.length > 0) {
      try {
        const output = JSON.parse(reviewRows[0].outputJson);
        reviewSummary = output.summary ?? undefined;
      } catch { /* ignore parse errors */ }
    }
    return { summary, reviewSummary };
  }

  async getLastSubmissionEvaluationForGuide(guide: typeof dailyGuides.$inferSelect): Promise<string | null> {
    const blockRows = await this.db
      .select()
      .from(dailyGuideBlocks)
      .where(eq(dailyGuideBlocks.guideId, guide.id));
    if (blockRows.length === 0) return null;

    const blockIds = blockRows.map((b) => b.planBlockId);
    const stepRows = await this.db
      .select()
      .from(learningSteps)
      .where(inArray(learningSteps.blockId, blockIds))
      .orderBy(desc(learningSteps.updatedAt))
      .limit(1);
    if (stepRows.length === 0) return null;

    const evalRows = await this.db
      .select()
      .from(learningEvaluations)
      .where(eq(learningEvaluations.stepId, stepRows[0].id))
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
    shortPlanDayId: string;
  }): Promise<DailyGuide> {
    return this.dailyGuidesStore.ensureDraftDailyGuide(params);
  }

  async saveDailyGuideWithTransaction(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    shortPlanDayId: string;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide }> {
    return this.dailyGuidesStore.saveDailyGuideWithTransaction(params);
  }

  async completeLearningDay(guideId: string): Promise<void> {
    const guideRows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    if (guideRows.length === 0) throw new Error('Guide not found');
    const guide = guideRows[0];
    await this.currentLearningContext.completeGuide(guideId);
    await this.markRoadmapStageReadyForReview(guide.goalId);
  }

  async getPendingEvaluationIdsForGoal(goalId: string): Promise<string[]> {
    return this.evaluations.getPendingEvaluationIdsForGoal(goalId);
  }

  async getActiveGuide(activeOnly: boolean = false): Promise<{ goal: LearningGoal | null; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide | null }> {
    return this.dailyGuidesStore.getActiveGuide(activeOnly);
  }

  async getGuideByDate(date: string): Promise<DailyGuide | null> {
    return this.dailyGuidesStore.getGuideByDate(date);
  }

  async activateShortPlanDay(shortPlanDayId: string): Promise<boolean> {
    return this.dailyGuidesStore.activateShortPlanDay(shortPlanDayId);
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

  async getPendingShortPlanDaysForGoal(goalId: string): Promise<ShortPlanDay[]> {
    return this.dailyGuidesStore.getPendingShortPlanDaysForGoal(goalId);
  }

  async updateShortPlanDay(shortPlanDayId: string, patch: Partial<ShortPlanDay>): Promise<ShortPlanDay | null> {
    return this.dailyGuidesStore.updateShortPlanDay(shortPlanDayId, patch);
  }

  async getCompletedGuidesForGoal(goalId: string): Promise<DailyGuide[]> {
    return this.dailyGuidesStore.getCompletedGuidesForGoal(goalId);
  }

  async promoteQuestionThread(threadId: string, target: { taskId: string }): Promise<void> {
    await this.questionBranches.promoteQuestionThread(threadId, target);
  }

  async updateQuestionThreadKind(threadId: string, kind: 'question' | 'debug' | 'practice'): Promise<void> {
    await this.questionBranches.updateQuestionThreadKind(threadId, kind);
  }

  async updateQuestionThreadMetadata(threadId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.questionBranches.updateQuestionThreadMetadata(threadId, metadata);
  }

  async createTaskFromBranch(branchSummary: string, anchor: { goalId: string; taskId: string }): Promise<string> {
    return this.questionBranches.createTaskFromBranch(branchSummary, anchor);
  }

  async extractKnowledgeFromBranch(summary: string, sourceId: string, goalId: string): Promise<void> {
    await this.questionBranches.extractKnowledgeFromBranch(summary, sourceId, goalId);
  }

  async closeCurrentSession(guideId: string): Promise<void> {
    await this.currentLearningContext.completeGuide(guideId);
  }

  async getDailyGuideTaskByBlockId(blockId: string): Promise<DailyGuideTask | null> {
    const tasks = await this.getDailyGuideTasksByBlockId(blockId);
    return tasks.find((task) => task.legacyPlanBlockId === blockId || task.id === blockId) ?? null;
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

  async recordFocusEvent(params: {
    sessionId: string | null;
    appName: string;
    windowTitle: string | null;
    eventType: 'foreground' | 'away' | 'return' | 'unknown';
    durationSeconds?: number;
  }): Promise<void> {
    await this.runtime.recordFocusEvent(params);
  }

  async listSessions(): Promise<StudySession[]> {
    return this.runtime.listSessions();
  }

  async getCurrentLearningContext() {
    return this.currentLearningContext.resolve();
  }

  async getAccumulatedSeconds(blockId: string, excludeSessionId?: string): Promise<number> {
    return this.runtime.getAccumulatedSeconds(blockId, excludeSessionId);
  }

  async getBlock(blockId: string): Promise<DailyPlanBlock | null> {
    const rows = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    return rows[0] ? mapPlanBlock(rows[0]) : null;
  }

  async getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot> {
    return this.runtime.getSnapshot();
  }

  async completeCurrentAction(): Promise<LearningRuntimeSnapshot> {
    return this.runtime.completeCurrentAction();
  }

  async skipCurrentAction(): Promise<LearningRuntimeSnapshot> {
    return this.runtime.skipCurrentAction();
  }

  async skipCurrentTask(): Promise<LearningRuntimeSnapshot> {
    return this.runtime.skipCurrentTask();
  }

  async openQuestion(actionId: string | null, question: string, opts?: { goalId?: string; kind?: 'question' | 'debug' | 'practice'; metadata?: Record<string, unknown> }): Promise<QuestionThread> {
    return this.questionBranches.openQuestion(actionId, question, opts);
  }

  async addQuestionMessage(threadId: string, role: 'user' | 'assistant', content: string): Promise<QuestionMessage> {
    return this.questionBranches.addQuestionMessage(threadId, role, content);
  }

  async getQuestionMessages(threadId: string): Promise<QuestionMessage[]> {
    return this.questionBranches.getQuestionMessages(threadId);
  }

  async saveQuestionAnswer(threadId: string, output: AnswerStepQuestionAgentOutput): Promise<QuestionThread> {
    return this.questionBranches.saveQuestionAnswer(threadId, output);
  }

  async resolveQuestion(threadId: string, summary?: string): Promise<void> {
    await this.questionBranches.resolveQuestion(threadId, summary);
  }

  async beginLearningSummary(kind: LearningSummary['kind'], refId: string): Promise<LearningSummary> {
    return this.questionBranches.beginLearningSummary(kind, refId);
  }

  async completeLearningSummary(summaryId: string, summary: unknown): Promise<LearningSummary> {
    return this.questionBranches.completeLearningSummary(summaryId, summary);
  }

  async failLearningSummary(summaryId: string, errorCategory: string): Promise<LearningSummary> {
    return this.questionBranches.failLearningSummary(summaryId, errorCategory);
  }

  async getLatestLearningSummary(kind: LearningSummary['kind'], refId: string): Promise<LearningSummary | null> {
    return this.questionBranches.getLatestLearningSummary(kind, refId);
  }

  async createSubmission(
    actionId: string,
    sessionId: string | null,
    content: string
  ): Promise<LearningSubmission> {
    return this.evaluations.createSubmission(actionId, sessionId, content);
  }

  async getSubmissionById(submissionId: string): Promise<LearningSubmission | null> {
    return this.evaluations.getSubmissionById(submissionId);
  }

  async markSubmissionEvaluation(
    submissionId: string,
    status: 'evaluating' | 'completed' | 'failed'
  ): Promise<void> {
    await this.evaluations.markSubmissionEvaluation(submissionId, status);
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
    decisionOutput: NextStepDecisionAgentOutput;
    evaluationAiReviewId?: string;
    decisionAiReviewId?: string;
  }): Promise<{ evaluation: LearningEvaluation; decision: StoredNextStepDecision; nextAction: DailyGuideAction | null }> {
    return this.evaluations.saveEvaluationAndDecision(params);
  }

  /**
   * 崩溃恢复：查找 evaluation 已保存（taskCompleted=true）但 task 未完成的 submission，幂等推进。
   * 在 AppService.initialize() 启动时调用。
   */
  async recoverPendingEvaluationProgress(): Promise<{ recovered: number; conflicts: string[] }> {
    return this.evaluations.recoverPendingEvaluationProgress();
  }

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
    return this.planChanges.decidePlanAdjustment(proposalId, status);
  }

  async getPlanVersionsForGoal(goalId: string): Promise<PlanVersionEntry[]> {
    return this.planChanges.getPlanVersionsForGoal(goalId);
  }

  async createProposal(goalId: string, proposal: PlanProposalInput): Promise<PlanAdjustmentProposal> {
    return this.planChanges.createProposal(goalId, proposal);
  }

  async confirmProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    return this.planChanges.confirmProposal(proposalId);
  }

  async rejectProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    return this.planChanges.rejectProposal(proposalId);
  }

  async getDailyGuideById(guideId: string): Promise<DailyGuide | null> {
    return this.dailyGuidesStore.getDailyGuideById(guideId);
  }

  private async getDailyGuideTasksByBlockId(blockId: string): Promise<DailyGuideTask[]> {
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.legacyPlanBlockId, blockId))
      .limit(1);
    const currentTask = taskRows[0];
    if (!currentTask) return [];

    const guideTaskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, currentTask.guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of guideTaskRows) {
      const actionRows = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, task.id))
        .orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction)));
    }
    return tasks;
  }

  private async upsertRuntimeState(patch: Partial<Omit<LearningRuntimeState, 'id' | 'updatedAt'>>): Promise<LearningRuntimeState> {
    return this.runtime.updateState(patch);
  }

  async getQuestionThread(threadId: string): Promise<QuestionThread | null> {
    return this.questionBranches.getQuestionThread(threadId);
  }

  async listPromptProfiles(): Promise<PromptProfile[]> {
    return this.ops.listPromptProfiles();
  }

  async getPromptProfile(profileId?: string): Promise<PromptProfile> {
    return this.ops.getPromptProfile(profileId);
  }

  async updatePrompt(profileId: string, content: string): Promise<PromptProfile> {
    return this.ops.updatePrompt(profileId, content);
  }

  async saveAiReview(params: {
    kind:
      | 'import'
      | 'plan'
      | 'goal_intake'
      | 'roadmap'
      | 'short_plan'
      | 'daily_guide'
      | 'stage_outline'
      | 'teach_step'
      | 'question'
      | 'submission_evaluation'
      | 'next_step'
      | 'evaluation'
      | 'replan'
      | 'reflection'
      | 'rolling_plan';
    date?: string;
    provider: string;
    model: string;
    promptProfileId?: string;
    promptVersionId?: string | null;
    inputSnapshot: unknown;
    output: unknown;
    outputSchemaVersion: string;
    status: 'success' | 'failed';
    errorMessage?: string;
    metrics?: AiCallMetrics;
  }): Promise<string> {
    return this.ops.saveAiReview(params);
  }

  async getLatestReview(date?: string): Promise<ReviewResult | null> {
    return this.ops.getLatestReview(date);
  }

  async getDaySnapshot(date: string) {
    return this.reporting.getDaySnapshot(date);
  }
}
