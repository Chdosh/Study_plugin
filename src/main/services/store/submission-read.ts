import { and, desc, eq } from 'drizzle-orm';
import type { LearningSubmission } from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  aiReviews,
  learningEvaluations,
  learningSubmissions
} from '../../db/schema';
import { mapSubmission } from './serialization';

export async function readSubmission(
  db: Database,
  submissionId: string
): Promise<LearningSubmission | null> {
  const row = (await db.select().from(learningSubmissions)
    .where(eq(learningSubmissions.id, submissionId)).limit(1))[0];
  if (!row) return null;

  const mapped = mapSubmission(row);
  const evaluation = (await db.select({
    id: learningEvaluations.id,
    applicationStatus: learningEvaluations.applicationStatus,
    applicationError: learningEvaluations.applicationError,
    appliedAt: learningEvaluations.appliedAt
  }).from(learningEvaluations)
    .where(and(
      eq(learningEvaluations.kind, 'submission'),
      eq(learningEvaluations.submissionId, submissionId)
    )).orderBy(desc(learningEvaluations.createdAt)).limit(1))[0];
  if (evaluation) {
    mapped.evaluationStatus = 'completed';
    mapped.applicationStatus = evaluation.applicationStatus;
    mapped.applicationError = evaluation.applicationError;
    mapped.appliedAt = evaluation.appliedAt;
    return mapped;
  }

  const latestRun = (await db.select({ status: aiReviews.status }).from(aiReviews)
    .where(and(
      eq(aiReviews.recordType, 'run'),
      eq(aiReviews.conversationScope, 'submission'),
      eq(aiReviews.conversationRefId, submissionId)
    )).orderBy(desc(aiReviews.createdAt)).limit(1))[0];
  if (latestRun) {
    mapped.evaluationStatus = (
      latestRun.status === 'running' || latestRun.status === 'waiting_user'
    ) ? 'evaluating' : 'failed';
  }
  return mapped;
}

export async function readLatestSubmissionForTask(
  db: Database,
  taskId: string
): Promise<LearningSubmission | null> {
  const row = (await db.select({ id: learningSubmissions.id }).from(learningSubmissions)
    .where(eq(learningSubmissions.taskId, taskId))
    .orderBy(desc(learningSubmissions.createdAt)).limit(1))[0];
  return row ? readSubmission(db, row.id) : null;
}
