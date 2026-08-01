import { and, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
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
import type { Database } from '../../db/client';
import {
  focusSessions,
  learningActions,
  learningEvaluations,
  learningSubmissions,
  learningTasks
} from '../../db/schema';
import { createId, nowIso } from '../id';
import type { RuntimePersistence } from './runtime-persistence';
import { mapDecision, mapEvaluation, mapSubmission } from './serialization';
import { readSubmission } from './submission-read';

export class EvaluationPersistence {
  constructor(
    private readonly db: Database,
    private readonly runtime: RuntimePersistence
  ) {}

  async createSubmission(params: {
    taskId: string;
    stepId?: string | null;
    sessionId?: string | null;
    content: string;
  }): Promise<LearningSubmission> {
    const clean = params.content.trim();
    if (!clean) throw new Error('提交内容不能为空。');
    const task = (await this.db.select().from(learningTasks)
      .where(eq(learningTasks.id, params.taskId)).limit(1))[0];
    if (!task) throw new Error('提交未绑定到有效 Task。');
    let stepId: string | null = null;
    if (params.stepId) {
      const stepAction = (await this.db.select({ id: learningActions.id, taskId: learningActions.taskId })
        .from(learningActions)
        .where(eq(learningActions.id, params.stepId)).limit(1))[0];
      if (stepAction && stepAction.taskId === params.taskId) {
        stepId = stepAction.id;
      }
    }
    if (params.sessionId) {
      const sessionRow = (await this.db.select({ taskId: focusSessions.taskId })
        .from(focusSessions)
        .where(eq(focusSessions.id, params.sessionId)).limit(1))[0];
      if (!sessionRow || sessionRow.taskId !== params.taskId) {
        throw new Error('提交的 Session 与当前 Task 不一致。');
      }
    }
    const row = {
      id: createId('submission'),
      taskId: params.taskId,
      stepId,
      goalId: task.goalId,
      sessionId: params.sessionId ?? null,
      content: clean,
      evaluationStatus: 'waiting' as const,
      evaluationAttemptCount: 0,
      lastEvaluationError: null,
      lastEvaluationAt: null,
      createdAt: nowIso()
    };
    await this.db.insert(learningSubmissions).values(row);
    return mapSubmission(row);
  }

  async markEvaluationEvaluating(submissionId: string): Promise<void> {
    await this.db.update(learningSubmissions).set({
      evaluationStatus: 'evaluating',
      evaluationAttemptCount: sql`${learningSubmissions.evaluationAttemptCount} + 1`,
      lastEvaluationAt: nowIso()
    }).where(eq(learningSubmissions.id, submissionId));
  }

  async markEvaluationCompleted(submissionId: string): Promise<void> {
    await this.db.update(learningSubmissions).set({
      evaluationStatus: 'completed',
      lastEvaluationAt: nowIso(),
      lastEvaluationError: null
    }).where(eq(learningSubmissions.id, submissionId));
  }

  async markEvaluationFailed(submissionId: string, errorMessage: string): Promise<void> {
    await this.db.update(learningSubmissions).set({
      evaluationStatus: 'failed',
      lastEvaluationAt: nowIso(),
      lastEvaluationError: errorMessage.slice(0, 500)
    }).where(eq(learningSubmissions.id, submissionId));
  }

  async getSubmissionsNeedingEvaluation(): Promise<string[]> {
    const rows = await this.db.select({ id: learningSubmissions.id })
      .from(learningSubmissions)
      .where(inArray(learningSubmissions.evaluationStatus, ['waiting', 'evaluating']));
    return rows.map((row) => row.id);
  }

  async getSubmissionById(submissionId: string): Promise<LearningSubmission | null> {
    return readSubmission(this.db, submissionId);
  }

  async saveEvaluationAndDecision(params: {
    submission: LearningSubmission;
    evaluationOutput: SubmissionEvaluationAgentOutput;
    direction: LearningEvaluation['decision'];
    decisionOutput: NextStepDecisionAgentOutput;
    evaluationAiReviewId?: string;
    decisionAiReviewId?: string;
  }): Promise<{
    evaluation: LearningEvaluation;
    decision: StoredNextStepDecision;
    nextAction: DailyGuideAction | null;
  }> {
    const submissionRow = (await this.db.select().from(learningSubmissions)
      .where(eq(learningSubmissions.id, params.submission.id)).limit(1))[0];
    if (!submissionRow) throw new Error('评价对应的 Submission 不存在。');
    const existing = (await this.db.select().from(learningEvaluations).where(and(
      eq(learningEvaluations.kind, 'submission'),
      eq(learningEvaluations.source, 'ai'),
      eq(learningEvaluations.submissionId, submissionRow.id)
    )).orderBy(desc(learningEvaluations.createdAt)).limit(1))[0];
    if (existing) {
      const snapshot = await this.runtime.getSnapshot();
      return {
        evaluation: mapEvaluation(existing),
        decision: mapDecision(existing),
        nextAction: snapshot.dailyGuideAction
      };
    }
    const now = nowIso();
    const selfNote = params.decisionOutput.carryForward.trim()
      || params.evaluationOutput.misconceptions[0]
      || params.evaluationOutput.missingRequirements[0]
      || null;
    const recommendation = {
      action: params.decisionOutput.decision,
      reason: params.decisionOutput.reason,
      taskCompleted: params.decisionOutput.taskCompleted,
      nextStep: params.decisionOutput.nextStep,
      remediation: params.decisionOutput.remediation
    };
    const row = {
      id: createId('evaluation'),
      kind: 'submission' as const,
      submissionId: submissionRow.id,
      goalId: submissionRow.goalId,
      result: params.evaluationOutput.result,
      evidenceJson: JSON.stringify(params.evaluationOutput.evidence),
      correctPartsJson: JSON.stringify(params.evaluationOutput.correctParts),
      misconceptionsJson: JSON.stringify(params.evaluationOutput.misconceptions),
      missingRequirementsJson: JSON.stringify(params.evaluationOutput.missingRequirements),
      feedback: params.evaluationOutput.feedback,
      direction: params.direction,
      selfNote,
      recommendationJson: JSON.stringify(recommendation),
      recommendationDecision: null,
      recommendationDecisionReason: null,
      applicationStatus: null,
      applicationError: null,
      appliedAt: null,
      source: 'ai' as const,
      supersedesEvaluationId: null,
      correctionReason: null,
      aiReviewId: params.decisionAiReviewId ?? params.evaluationAiReviewId ?? null,
      createdAt: now
    };
    await this.db.insert(learningEvaluations).values(row);
    const snapshot = await this.runtime.getSnapshot();
    return {
      evaluation: mapEvaluation(row),
      decision: mapDecision(row),
      nextAction: snapshot.dailyGuideAction
    };
  }

  async recordCorrection(
    evaluationId: string,
    reason: string
  ): Promise<{ evaluation: LearningEvaluation; goalId: string; submissionId: string }> {
    const cleanReason = reason.trim();
    if (!cleanReason) throw new Error('请说明评价中需要纠正的事实。');
    const original = (await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.id, evaluationId)).limit(1))[0];
    if (!original || original.kind !== 'submission' || !original.submissionId || !original.goalId) {
      throw new Error(`Submission evaluation not found: ${evaluationId}`);
    }
    const existing = (await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.supersedesEvaluationId, evaluationId)).limit(1))[0];
    if (existing) {
      return {
        evaluation: mapEvaluation(existing),
        goalId: original.goalId,
        submissionId: original.submissionId
      };
    }
    const row = {
      id: createId('evaluation_correction'),
      kind: 'submission' as const,
      submissionId: original.submissionId,
      goalId: original.goalId,
      result: 'unclear' as const,
      evidenceJson: JSON.stringify([cleanReason]),
      correctPartsJson: JSON.stringify([]),
      misconceptionsJson: JSON.stringify([]),
      missingRequirementsJson: JSON.stringify([]),
      feedback: `用户纠正：${cleanReason}`,
      direction: 'stay' as const,
      selfNote: cleanReason,
      recommendationJson: null,
      recommendationDecision: null,
      recommendationDecisionReason: null,
      applicationStatus: null,
      applicationError: null,
      appliedAt: null,
      source: 'user_correction' as const,
      supersedesEvaluationId: original.id,
      correctionReason: cleanReason,
      aiReviewId: null,
      createdAt: nowIso()
    };
    await this.db.insert(learningEvaluations).values(row);
    return {
      evaluation: mapEvaluation(row),
      goalId: original.goalId,
      submissionId: original.submissionId
    };
  }

  async getPendingEvaluationIdsForGoal(goalId: string): Promise<string[]> {
    const rows = await this.db.select({ id: learningSubmissions.id }).from(learningSubmissions)
      .where(and(
        eq(learningSubmissions.goalId, goalId),
        notExists(
          this.db.select({ id: learningEvaluations.id }).from(learningEvaluations).where(and(
            eq(learningEvaluations.kind, 'submission'),
            eq(learningEvaluations.submissionId, learningSubmissions.id)
          ))
        )
      ));
    return rows.map((row) => row.id);
  }

  async getSubmissionsForTask(taskId: string): Promise<LearningSubmission[]> {
    const rows = await this.db.select().from(learningSubmissions)
      .where(eq(learningSubmissions.taskId, taskId))
      .orderBy(desc(learningSubmissions.createdAt));
    const result: LearningSubmission[] = [];
    for (const row of rows) {
      const mapped = await this.getSubmissionById(row.id);
      if (mapped) result.push(mapped);
    }
    return result;
  }

  async getEvaluationsForTask(taskId: string): Promise<LearningEvaluation[]> {
    const submissions = await this.db.select({ id: learningSubmissions.id }).from(learningSubmissions)
      .where(eq(learningSubmissions.taskId, taskId));
    if (submissions.length === 0) return [];
    const rows = await this.db.select().from(learningEvaluations).where(and(
      eq(learningEvaluations.kind, 'submission'),
      inArray(learningEvaluations.submissionId, submissions.map((item) => item.id))
    )).orderBy(desc(learningEvaluations.createdAt));
    return rows.map(mapEvaluation);
  }
}
