import { desc, eq, sql } from 'drizzle-orm';
import type { LearningRuntimeSnapshot } from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  learningEvaluations,
  learningSubmissions,
  learningTasks
} from '../../db/schema';
import { nowIso } from '../id';
import type { RuntimePersistence } from './runtime-persistence';

export type RecommendationDecision = 'accepted' | 'declined' | 'deferred';

export class RecommendationCommandGateway {
  constructor(
    private readonly db: Database,
    private readonly runtime: RuntimePersistence
  ) {}

  async decide(
    evaluationId: string,
    decision: RecommendationDecision,
    reason?: string
  ): Promise<LearningRuntimeSnapshot> {
    const evaluation = (await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.id, evaluationId)).limit(1))[0];
    if (!evaluation || evaluation.kind !== 'submission') {
      throw new Error(`Submission evaluation not found: ${evaluationId}`);
    }
    if (!evaluation.recommendationJson) {
      throw new Error('该 Evaluation 没有可决定的 Recommendation。');
    }
    if (evaluation.recommendationDecision === decision && decision !== 'accepted') {
      return this.runtime.getSnapshot();
    }
    if (
      evaluation.recommendationDecision === 'accepted'
      && evaluation.applicationStatus === 'applied'
    ) {
      if (decision === 'accepted') return this.runtime.getSnapshot();
      throw new Error('该 Recommendation 已应用，不能改写用户决定。');
    }
    if (decision !== 'accepted') {
      await this.db.update(learningEvaluations).set({
        recommendationDecision: decision,
        recommendationDecisionReason: reason?.trim() || null,
        applicationStatus: null,
        applicationError: null,
        appliedAt: null
      }).where(eq(learningEvaluations.id, evaluationId));
      return this.runtime.getSnapshot();
    }

    const command = parseRecommendation(evaluation.recommendationJson);
    await this.db.update(learningEvaluations).set({
      recommendationDecision: 'accepted',
      recommendationDecisionReason: reason?.trim() || null,
      applicationStatus: command.action === 'complete_task' ? 'pending' : null,
      applicationError: null
    }).where(eq(learningEvaluations.id, evaluationId));

    if (command.action !== 'complete_task') {
      return this.runtime.getSnapshot();
    }

    try {
      if (!evaluation.submissionId) throw new Error('Recommendation 缺少 Submission 锚点。');
      const submission = (await this.db.select().from(learningSubmissions)
        .where(eq(learningSubmissions.id, evaluation.submissionId)).limit(1))[0];
      if (!submission) throw new Error('Recommendation 对应的 Submission 不存在。');
      const task = (await this.db.select().from(learningTasks)
        .where(eq(learningTasks.id, submission.taskId)).limit(1))[0];
      if (!task) throw new Error('Recommendation 对应的 Task 不存在。');
      const latestSubmission = (await this.db.select({
        id: learningSubmissions.id,
        rowId: sql<number>`rowid`
      })
        .from(learningSubmissions)
        .where(eq(learningSubmissions.taskId, task.id))
        .orderBy(desc(learningSubmissions.createdAt), desc(sql`rowid`))
        .limit(1))[0];
      if (latestSubmission?.id !== submission.id) {
        throw new Error('该 Recommendation 属于较早的成果尝试，不能作用到当前版本。');
      }
      await this.runtime.closeTask(
        task.id,
        'completed',
        reason?.trim() || evaluation.feedback
      );
      await this.db.update(learningEvaluations).set({
        applicationStatus: 'applied',
        appliedAt: nowIso()
      }).where(eq(learningEvaluations.id, evaluationId));
    } catch (error) {
      await this.db.update(learningEvaluations).set({
        applicationStatus: 'failed',
        applicationError: error instanceof Error ? error.message : 'command_application_failed'
      }).where(eq(learningEvaluations.id, evaluationId));
      throw error;
    }
    return this.runtime.getSnapshot();
  }
}

function parseRecommendation(raw: string): { action: string } {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (typeof value.action !== 'string' || !value.action.trim()) {
    throw new Error('Recommendation 不符合 V2 Command Schema。');
  }
  return { action: value.action };
}
