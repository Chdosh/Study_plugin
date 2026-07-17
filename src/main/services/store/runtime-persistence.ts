import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type {
  DailyGuide,
  DailyGuideAction,
  DailyGuideBlock,
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
  StudySession
} from '../../../shared/types';
import { completeAction, skipAction, skipTask, type ExecutionState } from '../../domain/execution-state-machine';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  focusEvents,
  goals,
  learningEvaluations,
  learningRuntimeStates,
  learningSubmissions,
  nextStepDecisions,
  planAdjustmentProposals,
  questionMessages,
  questionThreads,
  roadmapStages,
  studySessions
} from '../../db/schema';
import { createId, nowIso } from '../id';
import {
  mapDailyGuide,
  mapDailyGuideAction,
  mapDailyGuideBlock,
  mapDailyGuideTask,
  mapDecision,
  mapEvaluation,
  mapGoal,
  mapPlanAdjustmentProposal,
  mapPlanBlock,
  mapQuestionMessage,
  mapQuestionThread,
  mapRoadmapStage,
  mapRuntimeState,
  mapSession,
  mapSubmission
} from './serialization';
import type { CurrentLearningContextPersistence } from './current-learning-context';

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
    const rows = await this.db
      .select()
      .from(learningRuntimeStates)
      .where(eq(learningRuntimeStates.id, 'default'))
      .limit(1);
    if (rows[0]) return mapRuntimeState(rows[0]);

    const row = {
      id: 'default' as const,
      activeGoalId: null,
      activeStageId: null,
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle' as const,
      updatedAt: nowIso()
    };
    await this.db.insert(learningRuntimeStates).values(row);
    return row;
  }

  async updateState(patch: Partial<Omit<LearningRuntimeState, 'id' | 'updatedAt'>>): Promise<LearningRuntimeState> {
    const current = await this.getState();
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    await this.db
      .insert(learningRuntimeStates)
      .values(next)
      .onConflictDoUpdate({
        target: learningRuntimeStates.id,
        set: {
          activeGoalId: next.activeGoalId,
          activeStageId: next.activeStageId,
          activeDailyTaskId: next.activeDailyTaskId,
          activeStepId: next.activeStepId,
          activeQuestionThreadId: next.activeQuestionThreadId,
          sessionStatus: next.sessionStatus,
          updatedAt: next.updatedAt
        }
      });
    if (next.activeStepId) this.cachedActiveStepId = next.activeStepId;
    return next;
  }

  async startSession(taskId: string): Promise<StudySession> {
    await this.currentLearningContext.prepareSessionStart(taskId);
    const guideTask = await this.getDailyGuideTaskById(taskId);
    if (!guideTask) throw new Error(`找不到主任务：${taskId}`);
    if (guideTask.status === 'done') {
      throw new Error('当前主任务已完成，不能重新开始学习。');
    }

    const existingSessions = await this.db.select().from(studySessions).where(eq(studySessions.taskId, taskId));
    const existingActive = existingSessions.find((session) => session.status === 'active');
    if (existingActive) {
      await this.initializeLearningForTask(taskId, 'active');
      return mapSession(existingActive);
    }
    const existingPaused = existingSessions
      .filter((session) => session.status === 'paused')
      .sort((a, b) => new Date(b.endedAt ?? b.startedAt).getTime() - new Date(a.endedAt ?? a.startedAt).getTime())[0];
    if (existingPaused) {
      const resumedAt = nowIso();
      await this.db
        .update(studySessions)
        .set({
          startedAt: resumedAt,
          endedAt: null,
          status: 'active'
        })
        .where(eq(studySessions.id, existingPaused.id));
      await this.initializeLearningForTask(taskId, 'active');
      const rows = await this.db.select().from(studySessions).where(eq(studySessions.id, existingPaused.id)).limit(1);
      return mapSession(rows[0]);
    }
    const row = {
      id: createId('session'),
      taskId,
      taskItemsId: null,
      startedAt: nowIso(),
      endedAt: null,
      durationMinutes: null,
      status: 'active' as const,
      focusScore: null,
      notes: null
    };
    await this.db.insert(studySessions).values(row);
    await this.initializeLearningForTask(taskId, 'active');
    return row;
  }

  async pauseSession(sessionId: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'paused');
    if (session.taskId) {
      await this.updateDailyGuideTaskElapsed(session.taskId);
      const runtime = await this.getState();
      if (runtime.activeDailyTaskId === session.taskId) {
        await this.updateState({ sessionStatus: 'paused' });
      }
    }
    return session;
  }

  async completeSession(sessionId: string, notes?: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'completed', notes);
    if (session.taskId) {
      await this.updateDailyGuideTaskElapsed(session.taskId);
      const runtime = await this.getState();
      if (runtime.activeDailyTaskId === session.taskId) {
        await this.updateState({ sessionStatus: 'completed' });
      }
    }
    return session;
  }

  async recordFocusEvent(params: {
    sessionId: string | null;
    appName: string;
    windowTitle: string | null;
    eventType: 'foreground' | 'away' | 'return' | 'unknown';
    durationSeconds?: number;
  }): Promise<void> {
    await this.db.insert(focusEvents).values({
      id: createId('focus'),
      sessionId: params.sessionId,
      appName: params.appName,
      windowTitle: params.windowTitle,
      eventType: params.eventType,
      startedAt: nowIso(),
      endedAt: null,
      durationSeconds: params.durationSeconds
    });
  }

  async listSessions(): Promise<StudySession[]> {
    const rows = await this.db.select().from(studySessions).orderBy(desc(studySessions.startedAt));
    return rows.map(mapSession);
  }

  async getAccumulatedSeconds(taskId: string, excludeSessionId?: string): Promise<number> {
    const rows = await this.db.select().from(studySessions).where(eq(studySessions.taskId, taskId));
    let total = 0;
    for (const row of rows) {
      if (excludeSessionId && row.id === excludeSessionId) continue;
      if (row.status === 'completed' || row.status === 'paused') {
        total += Math.round((row.durationMinutes ?? 0) * 60);
      }
    }
    return total;
  }

  async getSnapshot(): Promise<LearningRuntimeSnapshot> {
    const resolvedContext = await this.currentLearningContext.resolve();
    const state = resolvedContext.state;
    const [goal, questionThread] = await Promise.all([
      state.activeGoalId ? this.getGoal(state.activeGoalId) : Promise.resolve(null),
      state.activeQuestionThreadId ? this.getQuestionThread(state.activeQuestionThreadId) : Promise.resolve(null)
    ]);

    let dailyGuide: DailyGuide | null = null;
    let dailyGuideTask: DailyGuideTask | null = null;
    let dailyGuideAction: DailyGuideAction | null = null;
    let roadmapStage: RoadmapStage | null = null;

    if (resolvedContext.displayGuideId) {
      dailyGuide = await this.getDailyGuideById(resolvedContext.displayGuideId);
    }

    if (resolvedContext.taskId) {
      dailyGuideTask = await this.getDailyGuideTaskById(resolvedContext.taskId);
      if (dailyGuideTask) {
        if (resolvedContext.actionId) {
          dailyGuideAction = dailyGuideTask.actions.find((a) => a.id === resolvedContext.actionId) ?? null;
        }
      }
    }

    if (state.activeStageId) {
      const rsRows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.id, state.activeStageId)).limit(1);
      roadmapStage = rsRows[0] ? mapRoadmapStage(rsRows[0]) : null;
    } else if (goal && !resolvedContext.stageConflict) {
      const rsRows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id)).orderBy(asc(roadmapStages.position)).limit(1);
      roadmapStage = rsRows[0] ? mapRoadmapStage(rsRows[0]) : null;
    }

    const questionThreadId = questionThread?.id ?? null;
    const [questionMessageRows, latestSubmission, latestEvaluation, latestDecision] = await Promise.all([
      questionThreadId ? this.listQuestionMessages(questionThreadId) : Promise.resolve([]),
      state.activeStepId ? this.getLatestSubmissionByActionId(state.activeStepId) : Promise.resolve(null),
      state.activeStepId ? this.getLatestEvaluationByActionId(state.activeStepId) : Promise.resolve(null),
      state.activeStepId ? this.getLatestDecisionByActionId(state.activeStepId) : Promise.resolve(null)
    ]);
    const pendingAdjustment = await this.getPendingAdjustment({
      goalId: goal?.id ?? null,
      stageId: null,
      taskId: null
    });

    return {
      state,
      goal,
      dailyGuide,
      dailyGuideTask,
      dailyGuideAction,
      roadmapStage,
      stageConflict: resolvedContext.stageConflict,
      questionThread,
      questionMessages: questionMessageRows,
      latestSubmission,
      latestEvaluation,
      latestDecision,
      pendingAdjustment
    };
  }

  getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot> {
    return this.getSnapshot();
  }

  async completeCurrentAction(): Promise<LearningRuntimeSnapshot> {
    const snapshot = await this.getSnapshot();
    const taskId = snapshot.state.activeDailyTaskId;
    if (!taskId) {
      throw new Error('当前没有可完成的主任务步骤。请先开始学习。');
    }

    const task = snapshot.dailyGuideTask;
    const tasks = task ? [task] : [];
    if (!task) {
      throw new Error('当前主任务没有可记录的行动步骤。');
    }
    if (task.actions.length === 0) {
      throw new Error('当前主任务没有行动步骤。');
    }

    const currentAction = task.currentAction ?? task.actions.find((action) => action.status !== 'done') ?? null;
    if (!currentAction) {
      return snapshot;
    }

    const now = nowIso();
    const result = completeAction({
      tasks,
      activeDailyTaskId: taskId,
      activeStepId: currentAction.id
    }, currentAction.id);
    if (!result.ok) {
      throw new Error(result.conflict.message);
    }
    await this.persistExecutionState(result.state, now);

    await this.updateState({
      activeDailyTaskId: result.state.activeDailyTaskId,
      activeStepId: result.state.activeStepId,
      activeQuestionThreadId: null,
      sessionStatus: snapshot.state.sessionStatus === 'idle' ? 'active' : snapshot.state.sessionStatus
    });

    return this.getSnapshot();
  }

  async skipCurrentAction(): Promise<LearningRuntimeSnapshot> {
    const snapshot = await this.getSnapshot();
    const taskId = snapshot.state.activeDailyTaskId;
    if (!taskId || !snapshot.dailyGuideTask) return snapshot;

    const tasks = [snapshot.dailyGuideTask];
    const currentAction = snapshot.dailyGuideTask.currentAction
      ?? snapshot.dailyGuideTask.actions.find((a) => a.status !== 'done')
      ?? null;
    if (!currentAction) return snapshot;

    const result = skipAction({
      tasks,
      activeDailyTaskId: taskId,
      activeStepId: currentAction.id
    });
    if (!result.ok) throw new Error(result.conflict.message);

    await this.persistExecutionState(result.state, nowIso());
    const updatedTask = result.state.tasks.find((t) => t.id === taskId);
    const nextAction = updatedTask?.currentAction ?? null;
    await this.updateState({
      activeDailyTaskId: result.state.activeDailyTaskId,
      activeStepId: result.state.activeStepId ?? nextAction?.id ?? null,
      activeQuestionThreadId: null,
      sessionStatus: snapshot.state.sessionStatus === 'idle' ? 'active' : snapshot.state.sessionStatus
    });
    return this.getSnapshot();
  }

  async skipCurrentTask(): Promise<LearningRuntimeSnapshot> {
    const snapshot = await this.getSnapshot();
    const taskId = snapshot.state.activeDailyTaskId;
    if (!taskId || !snapshot.dailyGuideTask) return snapshot;

    const tasks = snapshot.dailyGuide?.tasks ?? [snapshot.dailyGuideTask];
    const result = skipTask({ tasks, activeDailyTaskId: taskId, activeStepId: null });
    if (!result.ok) throw new Error(result.conflict.message);

    await this.persistExecutionState(result.state, nowIso());
    const resumableSessions = await this.db
      .select({ id: studySessions.id })
      .from(studySessions)
      .where(and(
        eq(studySessions.taskId, taskId),
        inArray(studySessions.status, ['active', 'paused'])
      ));
    for (const session of resumableSessions) {
      await this.finishSession(session.id, 'skipped', '主任务已跳过');
    }
    if (resumableSessions.length > 0) {
      await this.updateDailyGuideTaskElapsed(taskId);
    }
    const nextTask = result.state.activeDailyTaskId
      ? result.state.tasks.find((task) => task.id === result.state.activeDailyTaskId) ?? null
      : null;

    await this.updateState({
      activeDailyTaskId: result.state.activeDailyTaskId,
      activeStepId: result.state.activeStepId ?? nextTask?.currentAction?.id ?? null,
      activeQuestionThreadId: null,
      sessionStatus: nextTask ? 'idle' : 'completed'
    });

    if (!nextTask && snapshot.dailyGuide?.id) {
      const allTasksSkipped = result.state.tasks.length > 0
        && result.state.tasks.every((task) => task.status === 'skipped');
      if (allTasksSkipped) {
        await this.currentLearningContext.skipGuide(snapshot.dailyGuide.id);
      } else {
        await this.closeCurrentSession(snapshot.dailyGuide.id);
      }
    }

    return this.getSnapshot();
  }

  private async finishSession(
    sessionId: string,
    status: 'paused' | 'completed' | 'skipped',
    notes?: string
  ): Promise<StudySession> {
    const rows = await this.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
    const existing = rows[0];
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    const endedAt = nowIso();
    const previousSeconds = Math.round((existing.durationMinutes ?? 0) * 60);
    const currentSeconds =
      existing.status === 'active'
        ? Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(existing.startedAt).getTime()) / 1000))
        : 0;
    const durationMinutes = (previousSeconds + currentSeconds) / 60;
    await this.db
      .update(studySessions)
      .set({
        endedAt,
        durationMinutes,
        status,
        notes: notes ?? existing.notes
      })
      .where(eq(studySessions.id, sessionId));
    const updated = await this.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
    return mapSession(updated[0]);
  }

  private async initializeLearningForTask(taskId: string, sessionStatus?: LearningRuntimeState['sessionStatus']): Promise<LearningRuntimeSnapshot> {
    const guideTask = await this.getDailyGuideTaskById(taskId);
    const guide = guideTask
      ? (await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideTask.guideId)).limit(1))[0]
      : null;

    const stageId = guideTask?.roadmapStageId ?? null;

    const currentActionId = guideTask?.currentAction?.id
      ?? guideTask?.actions.find((action) => action.status !== 'done' && action.status !== 'skipped')?.id
      ?? null;

    await this.updateState({
      activeGoalId: guide?.goalId ?? null,
      activeStageId: stageId,
      activeDailyTaskId: guideTask?.id ?? null,
      activeStepId: currentActionId,
      activeQuestionThreadId: null,
      sessionStatus
    });

    return this.getSnapshot();
  }

  private async getGoal(goalId: string): Promise<LearningGoal | null> {
    const rows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    return rows[0] ? mapGoal(rows[0]) : null;
  }

  private async getQuestionThread(threadId: string): Promise<QuestionThread | null> {
    const rows = await this.db.select().from(questionThreads).where(eq(questionThreads.id, threadId)).limit(1);
    return rows[0] ? mapQuestionThread(rows[0]) : null;
  }

  private async listQuestionMessages(threadId: string): Promise<QuestionMessage[]> {
    const rows = await this.db
      .select()
      .from(questionMessages)
      .where(eq(questionMessages.threadId, threadId))
      .orderBy(asc(questionMessages.createdAt));
    return rows.map(mapQuestionMessage);
  }

  private async getDailyGuideById(guideId: string): Promise<DailyGuide | null> {
    const rows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    const guide = rows[0];
    if (!guide) return null;
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of taskRows) {
      const actionRows = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, task.id))
        .orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction)));
    }
    const guideBlockRows = await this.db
      .select()
      .from(dailyGuideBlocks)
      .where(eq(dailyGuideBlocks.guideId, guideId))
      .orderBy(asc(dailyGuideBlocks.position));
    const blocks: DailyGuideBlock[] = [];
    for (const guideBlock of guideBlockRows) {
      const planBlockRows = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, guideBlock.planBlockId)).limit(1);
      if (planBlockRows[0]) {
        blocks.push(mapDailyGuideBlock(guideBlock, mapPlanBlock(planBlockRows[0])));
      }
    }
    return mapDailyGuide(guide, blocks, tasks);
  }

  private async updateDailyGuideTaskElapsed(taskId: string): Promise<void> {
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(or(eq(dailyGuideTasks.id, taskId), eq(dailyGuideTasks.legacyPlanBlockId, taskId)))
      .limit(1);
    const task = taskRows[0];
    if (!task) return;
    const sessions = await this.db.select().from(studySessions).where(eq(studySessions.taskId, taskId));
    const totalElapsedMinutes = Math.round(sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0));
    await this.db
      .update(dailyGuideTasks)
      .set({
        totalElapsedMinutes,
        updatedAt: nowIso()
      })
      .where(eq(dailyGuideTasks.id, task.id));
  }

  private async getDailyGuideTaskById(taskId: string): Promise<DailyGuideTask | null> {
    const taskRows = await this.db.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.id, taskId)).limit(1);
    if (!taskRows[0]) return null;
    const actionRows = await this.db.select().from(dailyGuideActions).where(eq(dailyGuideActions.taskId, taskId)).orderBy(asc(dailyGuideActions.position));
    return mapDailyGuideTask(taskRows[0], actionRows.map(mapDailyGuideAction));
  }

  private async persistExecutionState(state: Pick<ExecutionState, 'tasks'>, timestamp: string): Promise<void> {
    for (const task of state.tasks) {
      await this.db
        .update(dailyGuideTasks)
        .set({
          status: task.status,
          progressPercent: task.progressPercent,
          currentActionId: task.status === 'active' ? task.currentAction?.id ?? null : null,
          nextStartPoint: task.nextStartPoint,
          updatedAt: timestamp
        })
        .where(eq(dailyGuideTasks.id, task.id));
      for (const action of task.actions) {
        await this.db
          .update(dailyGuideActions)
          .set({
            status: action.status,
            completedAt: action.status === 'done' ? (action.completedAt ?? timestamp) : action.completedAt
          })
          .where(eq(dailyGuideActions.id, action.id));
      }
      if (task.legacyPlanBlockId && task.status === 'done') {
        await this.db
          .update(dailyPlanBlocks)
          .set({ status: 'done' })
          .where(eq(dailyPlanBlocks.id, task.legacyPlanBlockId));
      }
    }
  }

  private async getLatestSubmissionByActionId(actionId: string): Promise<LearningSubmission | null> {
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(or(
        eq(learningSubmissions.dailyGuideActionId, actionId),
        eq(learningSubmissions.stepId, actionId)
      ))
      .orderBy(desc(learningSubmissions.createdAt))
      .limit(1);
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  private async getLatestEvaluationByActionId(actionId: string): Promise<LearningEvaluation | null> {
    const rows = await this.db
      .select()
      .from(learningEvaluations)
      .where(or(
        eq(learningEvaluations.dailyGuideActionId, actionId),
        eq(learningEvaluations.stepId, actionId)
      ))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    return rows[0] ? mapEvaluation(rows[0]) : null;
  }

  private async getLatestDecisionByActionId(actionId: string): Promise<StoredNextStepDecision | null> {
    const evaluationRows = await this.db
      .select({ id: learningEvaluations.id })
      .from(learningEvaluations)
      .where(or(
        eq(learningEvaluations.dailyGuideActionId, actionId),
        eq(learningEvaluations.stepId, actionId)
      ))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    if (!evaluationRows[0]) return null;
    const rows = await this.db
      .select()
      .from(nextStepDecisions)
      .where(eq(nextStepDecisions.evaluationId, evaluationRows[0].id))
      .orderBy(desc(nextStepDecisions.createdAt))
      .limit(1);
    return rows[0] ? mapDecision(rows[0]) : null;
  }

  private async getPendingAdjustment(params: {
    goalId: string | null;
    stageId: string | null;
    taskId: string | null;
  }): Promise<PlanAdjustmentProposal | null> {
    const rows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.status, 'pending'))
      .orderBy(desc(planAdjustmentProposals.createdAt));
    const mapped = rows.map(mapPlanAdjustmentProposal);
    return (
      mapped.find((item) => params.taskId && item.taskId === params.taskId) ??
      mapped.find((item) => params.stageId && item.stageId === params.stageId) ??
      mapped.find((item) => params.goalId && item.goalId === params.goalId) ??
      null
    );
  }

  private async closeCurrentSession(guideId: string): Promise<void> {
    await this.currentLearningContext.completeGuide(guideId);
  }
}
