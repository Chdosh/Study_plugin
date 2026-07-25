import { and, asc, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type {
  DailyGuide,
  DailyGuideAction,
  DailyGuideTask,
  LearningEvaluation,
  LearningGoal,
  LearningRuntimeSnapshot,
  LearningRuntimeState,
  LearningSubmission,
  PlanAdjustmentProposal,
  QuestionMessage,
  QuestionThread,
  RoadmapStage,
  StoredNextStepDecision,
  StudySession,
  SubmissionAttemptHistory
} from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  conversationMessages,
  conversationThreads,
  focusSessions,
  goals,
  learningActions,
  learningEvaluations,
  learningGuides,
  learningSubmissions,
  learningTasks,
  roadmapStages
} from '../../db/schema';
import { createId, nowIso } from '../id';
import {
  mapDailyGuide,
  mapDailyGuideAction,
  mapDailyGuideTask,
  mapDecision,
  mapEvaluation,
  mapGoal,
  mapPlanAdjustmentProposal,
  mapQuestionMessage,
  mapQuestionThread,
  mapRoadmapStage,
  mapSession,
  mapSubmission
} from './serialization';
import type { CurrentLearningContextPersistence } from './current-learning-context';
import { readLatestSubmissionForTask, readSubmission } from './submission-read';

export class RuntimePersistence {
  private cachedActiveStepId: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly currentLearningContext: CurrentLearningContextPersistence
  ) {}

  getActiveStepId(): string | null {
    return this.cachedActiveStepId;
  }

  async getState(): Promise<LearningRuntimeState> {
    const resolved = await this.currentLearningContext.resolve();
    this.cachedActiveStepId = resolved.actionId;
    return resolved.state;
  }

  async updateState(
    patch: Partial<Omit<LearningRuntimeState, 'id' | 'updatedAt'>>
  ): Promise<LearningRuntimeState> {
    await this.currentLearningContext.write({
      ...(patch.activeGoalId !== undefined ? { goalId: patch.activeGoalId } : {}),
      ...(patch.activeDailyTaskId !== undefined ? { taskId: patch.activeDailyTaskId } : {}),
      ...(patch.activeStepId !== undefined ? { actionId: patch.activeStepId } : {})
    });
    return this.getState();
  }

  async startSession(taskId: string): Promise<StudySession> {
    const now = nowIso();
    const result = await this.db.transaction(async (tx) => {
      await this.currentLearningContext.prepareSessionStart(taskId, tx);
      const unfinished = (await tx.select().from(focusSessions)
        .where(inArray(focusSessions.status, ['active', 'paused']))
        .orderBy(desc(focusSessions.startedAt)).limit(1))[0] ?? null;
      if (unfinished) {
        if (unfinished.taskId !== taskId) {
          throw new Error('已有未结束的 Focus Session，请先暂停后的 Session 结束，或继续原 Task。');
        }
        if (unfinished.status === 'paused') {
          const rows = await tx.update(focusSessions).set({
            status: 'active',
            activeSince: now
          }).where(eq(focusSessions.id, unfinished.id)).returning();
          return rows[0];
        }
        return unfinished;
      }
      const row = {
        id: createId('session'),
        taskId,
        startedAt: now,
        activeSince: now,
        endedAt: null,
        durationSeconds: 0,
        status: 'active' as const,
        notes: null
      };
      await tx.insert(focusSessions).values(row);
      await tx.update(learningTasks).set({ status: 'active', updatedAt: now })
        .where(and(eq(learningTasks.id, taskId), ne(learningTasks.status, 'closed')));
      return row;
    });
    return mapSession(result);
  }

  async pauseSession(sessionId: string): Promise<StudySession> {
    const now = nowIso();
    const rows = await this.db.transaction(async (tx) => {
      const session = (await tx.select().from(focusSessions)
        .where(eq(focusSessions.id, sessionId)).limit(1))[0];
      if (!session) throw new Error(`Focus Session not found: ${sessionId}`);
      if (session.status === 'ended') return [session];
      const durationSeconds = session.durationSeconds + elapsedSeconds(session.activeSince, now);
      return tx.update(focusSessions).set({
        status: 'paused',
        activeSince: null,
        durationSeconds
      }).where(eq(focusSessions.id, sessionId)).returning();
    });
    return mapSession(rows[0]);
  }

  async completeSession(sessionId: string, notes?: string): Promise<StudySession> {
    const now = nowIso();
    const rows = await this.db.transaction(async (tx) => {
      const session = (await tx.select().from(focusSessions)
        .where(eq(focusSessions.id, sessionId)).limit(1))[0];
      if (!session) throw new Error(`Focus Session not found: ${sessionId}`);
      if (session.status === 'ended') return [session];
      const durationSeconds = session.durationSeconds + elapsedSeconds(session.activeSince, now);
      return tx.update(focusSessions).set({
        status: 'ended',
        activeSince: null,
        endedAt: now,
        durationSeconds,
        notes: notes?.trim() || session.notes
      }).where(eq(focusSessions.id, sessionId)).returning();
    });
    return mapSession(rows[0]);
  }

  async listSessions(): Promise<StudySession[]> {
    const rows = await this.db.select().from(focusSessions).orderBy(desc(focusSessions.startedAt));
    return rows.map(mapSession);
  }

  async getAccumulatedSeconds(taskId: string, excludeSessionId?: string): Promise<number> {
    const filters = [eq(focusSessions.taskId, taskId)];
    if (excludeSessionId) filters.push(ne(focusSessions.id, excludeSessionId));
    const rows = await this.db.select({ total: sql<number>`COALESCE(SUM(${focusSessions.durationSeconds}), 0)` })
      .from(focusSessions).where(and(...filters));
    return Number(rows[0]?.total ?? 0);
  }

  async getSnapshot(): Promise<LearningRuntimeSnapshot> {
    const resolved = await this.currentLearningContext.resolve();
    this.cachedActiveStepId = resolved.actionId;
    const goal = resolved.goalId ? await this.getGoal(resolved.goalId) : null;
    const dailyGuide = resolved.displayGuideId ? await this.getGuide(resolved.displayGuideId) : null;
    const dailyGuideTask = resolved.taskId ? await this.getTask(resolved.taskId) : null;
    const dailyGuideAction = dailyGuideTask
      ? dailyGuideTask.actions.find((item) => item.id === resolved.actionId)
        ?? dailyGuideTask.actions.find((item) => item.status === 'planned')
        ?? null
      : null;
    if (dailyGuideAction?.id !== resolved.actionId) {
      await this.currentLearningContext.write({ actionId: dailyGuideAction?.id ?? null });
      resolved.state.activeStepId = dailyGuideAction?.id ?? null;
    }
    const roadmapStage = dailyGuideTask?.roadmapStageId
      ? await this.getStage(dailyGuideTask.roadmapStageId)
      : null;
    const questionThread = dailyGuideTask ? await this.getOpenThread(dailyGuideTask.id) : null;
    const questionMessages = questionThread ? await this.getMessages(questionThread.id) : [];
    const latestSubmission = dailyGuideTask ? await this.getLatestSubmission(dailyGuideTask.id) : null;
    const latestEvaluation = latestSubmission ? await this.getLatestEvaluation(latestSubmission.id) : null;
    const latestDecision = latestEvaluation ? await this.getDecision(latestEvaluation.id) : null;
    const submissionAttempts = dailyGuideTask
      ? await this.getSubmissionAttempts(dailyGuideTask.id)
      : [];
    const pendingAdjustment = goal ? await this.getPendingAdjustment(goal.id) : null;

    return {
      state: resolved.state,
      goal,
      dailyGuide,
      dailyGuideTask,
      dailyGuideAction,
      roadmapStage,
      stageConflict: null,
      questionThread,
      questionMessages,
      latestSubmission,
      latestEvaluation,
      latestDecision,
      submissionAttempts,
      pendingAdjustment
    };
  }

  getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot> {
    return this.getSnapshot();
  }

  async completeCurrentAction(): Promise<LearningRuntimeSnapshot> {
    return this.finishCurrentAction('done');
  }

  async skipCurrentAction(): Promise<LearningRuntimeSnapshot> {
    return this.finishCurrentAction('skipped');
  }

  async insertGuideSupplement(params: {
    title: string;
    instruction: string;
    checkpoint: string;
    sourceAiReviewId: string;
    expectedContextVersion: number;
  }): Promise<DailyGuideAction> {
    const existing = (await this.db.select().from(learningActions)
      .where(eq(learningActions.sourceAiReviewId, params.sourceAiReviewId))
      .limit(1))[0];
    if (existing) return mapDailyGuideAction(existing);

    const resolved = await this.currentLearningContext.resolve();
    if (
      resolved.version !== params.expectedContextVersion
      || !resolved.taskId
      || !resolved.actionId
      || !resolved.activeGuideId
    ) {
      throw new Error('学习上下文已经变化，临时补充内容没有写入。');
    }
    const currentAction = (await this.db.select().from(learningActions)
      .where(and(
        eq(learningActions.id, resolved.actionId),
        eq(learningActions.taskId, resolved.taskId),
        eq(learningActions.status, 'planned')
      ))
      .limit(1))[0];
    if (!currentAction) {
      throw new Error('当前 Action 已经结束，临时补充内容没有写入。');
    }
    const currentTask = (await this.db.select({
      guideId: learningTasks.guideId,
      status: learningTasks.status
    }).from(learningTasks).where(eq(learningTasks.id, resolved.taskId)).limit(1))[0];
    if (
      !currentTask
      || currentTask.guideId !== resolved.activeGuideId
      || (currentTask.status !== 'planned' && currentTask.status !== 'active')
    ) {
      throw new Error('临时补充内容只能写入当前 Guide 中尚未关闭的 Task。');
    }

    return this.db.transaction(async (tx) => {
      const duplicate = (await tx.select().from(learningActions)
        .where(eq(learningActions.sourceAiReviewId, params.sourceAiReviewId))
        .limit(1))[0];
      if (duplicate) return mapDailyGuideAction(duplicate);

      await tx.update(learningActions).set({
        position: sql`${learningActions.position} + 1`
      }).where(and(
        eq(learningActions.taskId, resolved.taskId!),
        gte(learningActions.position, currentAction.position)
      ));
      const supplementId = createId('learning_action');
      await tx.insert(learningActions).values({
        id: supplementId,
        taskId: resolved.taskId!,
        title: params.title,
        instruction: params.instruction,
        checkpoint: params.checkpoint,
        requirement: 'optional',
        status: 'planned',
        origin: 'agent_supplement',
        sourceAiReviewId: params.sourceAiReviewId,
        position: currentAction.position
      });
      const pointerChanged = await this.currentLearningContext.replaceActionInTransaction(tx, {
        expectedVersion: params.expectedContextVersion,
        expectedActionId: resolved.actionId!,
        actionId: supplementId
      });
      if (!pointerChanged) {
        throw new Error('学习上下文已经变化，临时补充内容没有写入。');
      }
      const inserted = (await tx.select().from(learningActions)
        .where(eq(learningActions.id, supplementId)).limit(1))[0];
      return mapDailyGuideAction(inserted);
    });
  }

  async closeTask(
    taskId: string,
    closureKind: 'completed' | 'partial' | 'abandoned' | 'replaced',
    closureReason?: string,
    nextStartPoint?: string
  ): Promise<void> {
    await this.currentLearningContext.closeTask(
      taskId,
      closureKind,
      closureReason,
      nextStartPoint
    );
  }

  private async finishCurrentAction(status: 'done' | 'skipped'): Promise<LearningRuntimeSnapshot> {
    const resolved = await this.currentLearningContext.resolve();
    if (!resolved.taskId || !resolved.actionId) throw new Error('当前没有可处理的 Action。');
    const now = nowIso();
    await this.db.transaction(async (tx) => {
      await tx.update(learningActions).set({
        status,
        completedAt: now
      }).where(and(
        eq(learningActions.id, resolved.actionId!),
        eq(learningActions.taskId, resolved.taskId!)
      ));
    });
    const next = (await this.db.select({ id: learningActions.id }).from(learningActions)
      .where(and(eq(learningActions.taskId, resolved.taskId), eq(learningActions.status, 'planned')))
      .orderBy(asc(learningActions.position)).limit(1))[0];
    await this.currentLearningContext.write({ actionId: next?.id ?? null });
    return this.getSnapshot();
  }

  private async getGoal(id: string): Promise<LearningGoal | null> {
    const row = (await this.db.select().from(goals).where(eq(goals.id, id)).limit(1))[0];
    return row ? mapGoal(row) : null;
  }

  private async getStage(id: string): Promise<RoadmapStage | null> {
    const row = (await this.db.select().from(roadmapStages).where(eq(roadmapStages.id, id)).limit(1))[0];
    return row ? mapRoadmapStage(row) : null;
  }

  private async getGuide(id: string): Promise<DailyGuide | null> {
    const row = (await this.db.select().from(learningGuides).where(eq(learningGuides.id, id)).limit(1))[0];
    if (!row) return null;
    const taskRows = await this.db.select().from(learningTasks)
      .where(eq(learningTasks.guideId, id)).orderBy(asc(learningTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of taskRows) {
      const actions = await this.db.select().from(learningActions)
        .where(eq(learningActions.taskId, task.id)).orderBy(asc(learningActions.position));
      tasks.push(mapDailyGuideTask(task, actions.map(mapDailyGuideAction)));
    }
    return mapDailyGuide(row, [], tasks);
  }

  private async getTask(id: string): Promise<DailyGuideTask | null> {
    const row = (await this.db.select().from(learningTasks).where(eq(learningTasks.id, id)).limit(1))[0];
    if (!row) return null;
    const actions = await this.db.select().from(learningActions)
      .where(eq(learningActions.taskId, id)).orderBy(asc(learningActions.position));
    return mapDailyGuideTask(row, actions.map(mapDailyGuideAction));
  }

  private async getOpenThread(taskId: string): Promise<QuestionThread | null> {
    const rows = await this.db.select({
      thread: conversationThreads,
      goalId: conversationMessages.linkedGoalId,
      linkedTaskId: conversationMessages.linkedTaskId,
      linkedActionId: conversationMessages.linkedActionId
    }).from(conversationThreads)
      .innerJoin(conversationMessages, eq(conversationMessages.threadId, conversationThreads.id))
      .where(and(eq(conversationThreads.status, 'open'), eq(conversationMessages.linkedTaskId, taskId)))
      .orderBy(desc(conversationThreads.updatedAt)).limit(1);
    return rows[0] ? mapQuestionThread(rows[0].thread, {
      goalId: rows[0].goalId,
      taskId: rows[0].linkedTaskId,
      actionId: rows[0].linkedActionId
    }) : null;
  }

  private async getMessages(threadId: string): Promise<QuestionMessage[]> {
    const rows = await this.db.select().from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId)).orderBy(asc(conversationMessages.createdAt));
    return rows.map(mapQuestionMessage);
  }

  private async getLatestSubmission(taskId: string): Promise<LearningSubmission | null> {
    return readLatestSubmissionForTask(this.db, taskId);
  }

  private async getSubmissionAttempts(taskId: string): Promise<SubmissionAttemptHistory[]> {
    const submissionRows = await this.db.select().from(learningSubmissions)
      .where(eq(learningSubmissions.taskId, taskId))
      .orderBy(desc(learningSubmissions.createdAt));
    const result: SubmissionAttemptHistory[] = [];
    for (const row of submissionRows) {
      const submission = await readSubmission(this.db, row.id);
      if (!submission) continue;
      const evaluations = (await this.db.select().from(learningEvaluations)
        .where(and(
          eq(learningEvaluations.kind, 'submission'),
          eq(learningEvaluations.submissionId, row.id)
        ))
        .orderBy(desc(learningEvaluations.createdAt)))
        .map(mapEvaluation);
      result.push({
        submission,
        evaluations,
        latestEvaluation: evaluations[0] ?? null
      });
    }
    return result;
  }

  private async getLatestEvaluation(submissionId: string): Promise<LearningEvaluation | null> {
    const row = (await this.db.select().from(learningEvaluations)
      .where(and(
        eq(learningEvaluations.kind, 'submission'),
        eq(learningEvaluations.submissionId, submissionId)
      )).orderBy(desc(learningEvaluations.createdAt)).limit(1))[0];
    return row ? mapEvaluation(row) : null;
  }

  private async getDecision(evaluationId: string): Promise<StoredNextStepDecision | null> {
    const row = (await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.id, evaluationId)).limit(1))[0];
    return row?.recommendationJson ? mapDecision(row) : null;
  }

  private async getPendingAdjustment(goalId: string): Promise<PlanAdjustmentProposal | null> {
    const row = (await this.db.select().from(learningEvaluations)
      .where(and(
        eq(learningEvaluations.kind, 'goal_review'),
        eq(learningEvaluations.goalId, goalId),
        eq(learningEvaluations.recommendationDecision, 'pending')
      )).orderBy(desc(learningEvaluations.createdAt)).limit(1))[0];
    return row ? mapPlanAdjustmentProposal(row) : null;
  }
}

function elapsedSeconds(activeSince: string | null, now: string): number {
  if (!activeSince) return 0;
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(activeSince)) / 1000));
}
