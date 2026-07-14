import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  DailyGuideAction,
  LearningEvaluation,
  LearningSubmission,
  StoredNextStepDecision
} from '../../../shared/types';
import type {
  NextStepDecisionAgentOutput,
  SubmissionEvaluationAgentOutput
} from '../../../shared/schemas';
import { isPassingEvaluation } from '../../domain/execution-state-machine';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideTasks,
  dailyGuides,
  learningEvaluations,
  learningSubmissions,
  nextStepDecisions,
  studySessions
} from '../../db/schema';
import { createId, nowIso } from '../id';
import type { RuntimePersistence } from './runtime-persistence';
import {
  mapDailyGuideAction,
  mapDecision,
  mapEvaluation,
  mapSubmission
} from './serialization';

export class EvaluationPersistence {
  constructor(
    private readonly db: Database,
    private readonly runtime: RuntimePersistence,
    private readonly completeLearningDay: (guideId: string) => Promise<void>
  ) {}

  async createSubmission(
    actionId: string,
    sessionId: string | null,
    content: string
  ): Promise<LearningSubmission> {
    const row: LearningSubmission = {
      id: createId('submission'),
      stepId: null,
      dailyGuideActionId: actionId,
      sessionId,
      content,
      evaluationStatus: 'waiting',
      applicationStatus: 'pending',
      applicationError: null,
      appliedAt: null,
      createdAt: nowIso()
    };
    await this.db.insert(learningSubmissions).values(row);
    return row;
  }

  async getSubmissionById(submissionId: string): Promise<LearningSubmission | null> {
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(eq(learningSubmissions.id, submissionId))
      .limit(1);
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  async markSubmissionEvaluation(
    submissionId: string,
    status: 'evaluating' | 'completed' | 'failed'
  ): Promise<void> {
    await this.db
      .update(learningSubmissions)
      .set({ evaluationStatus: status })
      .where(eq(learningSubmissions.id, submissionId));
  }

  async saveEvaluationAndDecision(params: {
    submission: LearningSubmission;
    evaluationOutput: SubmissionEvaluationAgentOutput;
    decisionOutput: NextStepDecisionAgentOutput;
    evaluationAiReviewId?: string;
    decisionAiReviewId?: string;
  }): Promise<{ evaluation: LearningEvaluation; decision: StoredNextStepDecision; nextAction: DailyGuideAction | null }> {
    const snapshot = await this.runtime.getSnapshot();
    const action = snapshot.dailyGuideAction;
    if (!snapshot.dailyGuideTask) throw new Error('当前没有进行中的主任务。');
    if (!action) throw new Error('当前没有进行中的学习步骤。');

    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.id, snapshot.dailyGuideTask.id))
      .limit(1);
    if (taskRows.length === 0) throw new Error('主任务不存在。');
    const task = taskRows[0];

    const now = nowIso();
    const evaluationId = createId('evaluation');
    const decisionId = createId('decision');

    await this.db.transaction(async (tx) => {
      await tx.insert(learningEvaluations).values({
        id: evaluationId,
        submissionId: params.submission.id,
        stepId: null,
        dailyGuideActionId: params.submission.dailyGuideActionId ?? null,
        result: params.evaluationOutput.result,
        mastery: params.evaluationOutput.mastery,
        evidenceJson: JSON.stringify(params.evaluationOutput.evidence),
        correctPartsJson: JSON.stringify(params.evaluationOutput.correctParts),
        misconceptionsJson: JSON.stringify(params.evaluationOutput.misconceptions),
        missingRequirementsJson: JSON.stringify(params.evaluationOutput.missingRequirements),
        feedback: params.evaluationOutput.feedback,
        recommendedAction: params.evaluationOutput.recommendedAction,
        decision: params.evaluationOutput.decision,
        aiReviewId: params.evaluationAiReviewId ?? null,
        createdAt: now
      });

      await tx.insert(nextStepDecisions).values({
        id: decisionId,
        evaluationId,
        stepId: null,
        decision: params.decisionOutput.decision,
        reason: params.decisionOutput.reason,
        taskCompleted: params.decisionOutput.taskCompleted,
        nextStepJson: params.decisionOutput.nextStep ? JSON.stringify(params.decisionOutput.nextStep) : null,
        remediationJson: params.decisionOutput.remediation ? JSON.stringify(params.decisionOutput.remediation) : null,
        carryForward: params.decisionOutput.carryForward || null,
        aiReviewId: params.decisionAiReviewId ?? null,
        createdAt: now
      });

      await tx.update(learningSubmissions)
        .set({ evaluationStatus: 'completed', applicationStatus: 'pending', applicationError: null, appliedAt: null })
        .where(eq(learningSubmissions.id, params.submission.id));
    });

    const passed = isPassingEvaluation(params.evaluationOutput);
    if (!passed) {
      await this.markSubmissionApplication(params.submission.id, 'applied');
      const evaluation = await this.getEvaluation(evaluationId);
      const decision = await this.getDecision(decisionId);
      if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');
      return { evaluation, decision, nextAction: null };
    }

    let nextAction: DailyGuideAction | null;
    try {
      ({ nextAction } = await this.advanceAfterPassingEvaluation(task, action.id));
      await this.markSubmissionApplication(params.submission.id, 'applied');
    } catch (error) {
      await this.markSubmissionApplication(params.submission.id, 'failed', 'state_application_failed');
      throw error;
    }

    const evaluation = await this.getEvaluation(evaluationId);
    const decision = await this.getDecision(decisionId);
    if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');
    return { evaluation, decision, nextAction };
  }

  async recoverPendingEvaluationProgress(): Promise<{ recovered: number; conflicts: string[] }> {
    const conflicts: string[] = [];
    let recovered = 0;

    const completedSubmissions = await this.db
      .select()
      .from(learningSubmissions)
      .where(and(
        eq(learningSubmissions.evaluationStatus, 'completed'),
        inArray(learningSubmissions.applicationStatus, ['pending', 'failed'])
      ));

    for (const submission of completedSubmissions) {
      if (!submission.dailyGuideActionId) continue;

      const evaluations = await this.db
        .select()
        .from(learningEvaluations)
        .where(eq(learningEvaluations.submissionId, submission.id))
        .orderBy(desc(learningEvaluations.createdAt))
        .limit(1);
      if (evaluations.length === 0) continue;

      const decisions = await this.db
        .select()
        .from(nextStepDecisions)
        .where(eq(nextStepDecisions.evaluationId, evaluations[0].id))
        .orderBy(desc(nextStepDecisions.createdAt))
        .limit(1);
      if (decisions.length === 0) {
        await this.markSubmissionApplication(submission.id, 'failed', 'missing_decision');
        conflicts.push(`submission:${submission.id}:missing_decision`);
        continue;
      }
      if (!decisions[0].taskCompleted) {
        await this.markSubmissionApplication(submission.id, 'applied');
        recovered++;
        continue;
      }

      const actionRows = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.id, submission.dailyGuideActionId))
        .limit(1);
      if (actionRows.length === 0) {
        await this.markSubmissionApplication(submission.id, 'failed', 'missing_action');
        conflicts.push(`submission:${submission.id}:missing_action`);
        continue;
      }

      const taskRows = await this.db
        .select()
        .from(dailyGuideTasks)
        .where(eq(dailyGuideTasks.id, actionRows[0].taskId))
        .limit(1);
      if (taskRows.length === 0) {
        await this.markSubmissionApplication(submission.id, 'failed', 'missing_task');
        conflicts.push(`submission:${submission.id}:missing_task`);
        continue;
      }

      const task = taskRows[0];
      if (task.status === 'done') {
        await this.markSubmissionApplication(submission.id, 'applied');
        recovered++;
        continue;
      }

      try {
        await this.advanceAfterPassingEvaluation(task, submission.dailyGuideActionId);
        await this.markSubmissionApplication(submission.id, 'applied');
        recovered++;
      } catch {
        await this.markSubmissionApplication(submission.id, 'failed', 'state_application_failed');
        conflicts.push(`submission:${submission.id}:state_application_failed`);
      }
    }

    return { recovered, conflicts };
  }

  async getPendingEvaluationIdsForGoal(goalId: string): Promise<string[]> {
    const guideRows = await this.db
      .select({ id: dailyGuides.id })
      .from(dailyGuides)
      .where(and(eq(dailyGuides.goalId, goalId), inArray(dailyGuides.status, ['draft', 'confirmed', 'completed'])))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    const activeGuide = guideRows[0];
    if (!activeGuide) return [];

    const taskRows = await this.db
      .select({ id: dailyGuideTasks.id })
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, activeGuide.id));
    if (taskRows.length === 0) return [];

    const taskIds = taskRows.map((t) => t.id);
    const actionRows = await this.db
      .select({ id: dailyGuideActions.id })
      .from(dailyGuideActions)
      .where(inArray(dailyGuideActions.taskId, taskIds));
    if (actionRows.length === 0) return [];

    const actionIds = actionRows.map((a) => a.id);
    const submissionRows = await this.db
      .select({ id: learningSubmissions.id })
      .from(learningSubmissions)
      .where(and(
        inArray(learningSubmissions.dailyGuideActionId, actionIds),
        inArray(learningSubmissions.evaluationStatus, ['waiting', 'evaluating'])
      ));
    return submissionRows.map((s) => s.id);
  }

  async getSubmissionsForTask(taskId: string): Promise<LearningSubmission[]> {
    const actionRows = await this.db
      .select({ id: dailyGuideActions.id })
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, taskId));
    if (actionRows.length === 0) return [];
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(inArray(learningSubmissions.dailyGuideActionId, actionRows.map((action) => action.id)))
      .orderBy(desc(learningSubmissions.createdAt));
    return rows.map(mapSubmission);
  }

  async getEvaluationsForTask(taskId: string): Promise<LearningEvaluation[]> {
    const actionRows = await this.db
      .select({ id: dailyGuideActions.id })
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, taskId));
    if (actionRows.length === 0) return [];
    const submissionRows = await this.db
      .select()
      .from(learningSubmissions)
      .where(inArray(learningSubmissions.dailyGuideActionId, actionRows.map((action) => action.id)));
    const evaluations: LearningEvaluation[] = [];
    for (const sub of submissionRows) {
      const evRows = await this.db
        .select()
        .from(learningEvaluations)
        .where(eq(learningEvaluations.submissionId, sub.id))
        .orderBy(desc(learningEvaluations.createdAt));
      evaluations.push(...evRows.map(mapEvaluation));
    }
    return evaluations;
  }

  private async advanceAfterPassingEvaluation(
    task: typeof dailyGuideTasks.$inferSelect,
    actionId: string
  ): Promise<{ nextAction: DailyGuideAction | null; changed: boolean }> {
    const now = nowIso();
    let changed = false;

    const allActions = await this.db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, task.id))
      .orderBy(asc(dailyGuideActions.position));

    const currentAction = allActions.find((a) => a.id === actionId);
    if (currentAction && currentAction.status !== 'done') {
      await this.db
        .update(dailyGuideActions)
        .set({ status: 'done', completedAt: now })
        .where(eq(dailyGuideActions.id, actionId));
      changed = true;
    }

    const nextAction = allActions.find(
      (a) => a.id !== actionId && a.status !== 'done' && a.status !== 'skipped'
    ) ?? null;

    if (nextAction) {
      if (task.currentActionId !== nextAction.id) {
        await this.db
          .update(dailyGuideTasks)
          .set({ currentActionId: nextAction.id, updatedAt: now })
          .where(eq(dailyGuideTasks.id, task.id));
        await this.runtime.updateState({
          activeStepId: nextAction.id,
          activeDailyTaskId: task.id,
          activeQuestionThreadId: null,
          sessionStatus: 'active'
        });
        changed = true;
      }
      return { nextAction: mapDailyGuideAction(nextAction), changed };
    }

    const completedCount = allActions.filter((a) => a.status === 'done' || a.id === actionId).length;
    const progressPercent = allActions.length > 0
      ? Math.round((completedCount / allActions.length) * 100)
      : 100;
    if (task.status !== 'done') {
      await this.db
        .update(dailyGuideTasks)
        .set({
          status: 'done',
          progressPercent,
          currentActionId: null,
          nextStartPoint: null,
          updatedAt: now
        })
        .where(eq(dailyGuideTasks.id, task.id));
      changed = true;
    }

    const resumableSessions = await this.db
      .select({ id: studySessions.id })
      .from(studySessions)
      .where(and(eq(studySessions.taskId, task.id), inArray(studySessions.status, ['active', 'paused'])));
    for (const session of resumableSessions) {
      await this.runtime.completeSession(session.id, '主任务已通过评价');
      changed = true;
    }

    const allTasks = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, task.guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const nextTaskRow = allTasks.find(
      (t) => t.id !== task.id && t.status !== 'done' && t.status !== 'skipped' && t.status !== 'deferred'
    ) ?? null;

    if (nextTaskRow) {
      const nextTaskActions = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, nextTaskRow.id))
        .orderBy(asc(dailyGuideActions.position));
      const firstAction = nextTaskActions.find(
        (a) => a.status !== 'done' && a.status !== 'skipped'
      ) ?? null;
      const firstActionId = firstAction?.id ?? null;

      if (nextTaskRow.status !== 'active' || nextTaskRow.currentActionId !== firstActionId) {
        await this.db
          .update(dailyGuideTasks)
          .set({
            status: 'active',
            currentActionId: firstActionId,
            updatedAt: now
          })
          .where(eq(dailyGuideTasks.id, nextTaskRow.id));
        await this.runtime.updateState({
          activeDailyTaskId: nextTaskRow.id,
          activeStepId: firstActionId,
          activeQuestionThreadId: null,
          sessionStatus: 'active'
        });
        changed = true;
      }

      if (firstAction) {
        return { nextAction: mapDailyGuideAction(firstAction), changed };
      }
      return { nextAction: nextTaskActions[0] ? mapDailyGuideAction(nextTaskActions[0]) : null, changed };
    }

    await this.completeLearningDay(task.guideId);
    await this.runtime.updateState({
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'completed'
    });

    return { nextAction: null, changed: true };
  }

  private async markSubmissionApplication(
    submissionId: string,
    status: 'applied' | 'failed',
    error: string | null = null
  ): Promise<void> {
    await this.db
      .update(learningSubmissions)
      .set({
        applicationStatus: status,
        applicationError: error,
        appliedAt: status === 'applied' ? nowIso() : null
      })
      .where(eq(learningSubmissions.id, submissionId));
  }

  private async getEvaluation(evaluationId: string): Promise<LearningEvaluation | null> {
    const rows = await this.db.select().from(learningEvaluations).where(eq(learningEvaluations.id, evaluationId)).limit(1);
    return rows[0] ? mapEvaluation(rows[0]) : null;
  }

  private async getDecision(decisionId: string): Promise<StoredNextStepDecision | null> {
    const rows = await this.db.select().from(nextStepDecisions).where(eq(nextStepDecisions.id, decisionId)).limit(1);
    return rows[0] ? mapDecision(rows[0]) : null;
  }
}
