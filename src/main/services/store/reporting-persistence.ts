import { desc, eq, inArray } from 'drizzle-orm';
import type { DailyGuide, LearningEvaluation, LearningSubmission } from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  conversationMessages,
  conversationThreads,
  focusSessions,
  goals,
  knowledgeItemEvidence,
  knowledgeItems,
  learnerFacts,
  learningActions,
  learningEvaluations,
  learningGuides,
  learningSubmissions,
  learningTasks,
  nearTermPlanItems,
  planVersions,
  roadmapStages
} from '../../db/schema';
import { mapEvaluation, mapSession, mapSubmission } from './serialization';

type GetGuideById = (guideId: string) => Promise<DailyGuide | null>;

export class ReportingPersistence {
  constructor(
    private readonly db: Database,
    private readonly getGuideById: GetGuideById
  ) {}

  async exportGoalData(goalId: string): Promise<Record<string, unknown>> {
    const [goal, stages, planItems, guides, knowledge, facts, versions] = await Promise.all([
      this.db.select().from(goals).where(eq(goals.id, goalId)),
      this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goalId)),
      this.db.select().from(nearTermPlanItems).where(eq(nearTermPlanItems.goalId, goalId)),
      this.db.select().from(learningGuides).where(eq(learningGuides.goalId, goalId)),
      this.db.select().from(knowledgeItems).where(eq(knowledgeItems.goalId, goalId)),
      this.db.select().from(learnerFacts).where(eq(learnerFacts.goalId, goalId)),
      this.db.select().from(planVersions).where(eq(planVersions.goalId, goalId))
    ]);
    const tasks = await this.db.select().from(learningTasks).where(eq(learningTasks.goalId, goalId));
    const taskIds = tasks.map((item) => item.id);
    const actions = taskIds.length
      ? await this.db.select().from(learningActions).where(inArray(learningActions.taskId, taskIds))
      : [];
    const sessions = taskIds.length
      ? await this.db.select().from(focusSessions).where(inArray(focusSessions.taskId, taskIds))
      : [];
    const submissions = taskIds.length
      ? await this.db.select().from(learningSubmissions).where(inArray(learningSubmissions.taskId, taskIds))
      : [];
    const evaluations = await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.goalId, goalId));
    const messages = await this.db.select().from(conversationMessages)
      .where(eq(conversationMessages.linkedGoalId, goalId));
    const threadIds = [...new Set(messages.map((item) => item.threadId))];
    const threads = threadIds.length
      ? await this.db.select().from(conversationThreads).where(inArray(conversationThreads.id, threadIds))
      : [];
    const evidence = knowledge.length
      ? await this.db.select().from(knowledgeItemEvidence)
          .where(inArray(knowledgeItemEvidence.knowledgeItemId, knowledge.map((item) => item.id)))
      : [];
    return {
      schemaVersion: 'study-v2',
      exportedAt: new Date().toISOString(),
      goal: goal[0] ?? null,
      roadmapStages: stages,
      nearTermPlanItems: planItems,
      planVersions: versions,
      learningGuides: guides,
      learningTasks: tasks,
      learningActions: actions,
      focusSessions: sessions,
      learningSubmissions: submissions,
      learningEvaluations: evaluations,
      conversationThreads: threads,
      conversationMessages: messages,
      knowledgeItems: knowledge,
      knowledgeItemEvidence: evidence,
      learnerFacts: facts
    };
  }

  async getGuideSnapshot(guideId: string) {
    const guide = await this.getGuideById(guideId);
    return this.buildGuideSnapshot(guide, guide?.date ?? '');
  }

  private async buildGuideSnapshot(guide: DailyGuide | null, displayDate: string) {
    const sessions = await this.db.select().from(focusSessions)
      .orderBy(desc(focusSessions.startedAt));
    const guideTasks = [];
    for (const task of guide?.tasks ?? []) {
      const taskSessions = sessions.filter((item) => item.taskId === task.id).map(mapSession);
      const submission = await this.getLatestSubmission(task.id);
      const evaluation = submission ? await this.getLatestEvaluation(submission.id) : null;
      const submissionAttempts = await this.getSubmissionAttempts(task.id);
      const messages = await this.db.select({
        threadId: conversationMessages.threadId
      }).from(conversationMessages).where(eq(conversationMessages.linkedTaskId, task.id));
      const threadIds = [...new Set(messages.map((item) => item.threadId))];
      const threads = threadIds.length
        ? await this.db.select().from(conversationThreads)
            .where(inArray(conversationThreads.id, threadIds))
        : [];
      guideTasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        completedActionCount: task.actions.filter((item) => item.status === 'done').length,
        totalActionCount: task.actions.length,
        estimatedMinutes: task.estimatedMinutes,
        totalElapsedMinutes: taskSessions.reduce((total, item) => total + (item.durationMinutes ?? 0), 0),
        focusSessions: taskSessions.map((item) => ({
          startedAt: item.startedAt,
          endedAt: item.endedAt,
          elapsedMinutes: item.durationMinutes,
          pauseReason: item.notes,
          progressNote: item.notes
        })),
        finalSubmission: submission,
        evaluation,
        submissionAttempts,
        incompleteActions: task.actions.filter((item) => item.status !== 'done').map((item) => ({
          title: item.title,
          checkpoint: item.checkpoint,
          progressNote: item.progressNote
        })),
        questionTopics: threads.map((item) => item.question),
        nextStartPoint: task.nextStartPoint
      });
    }
    return {
      guideId: guide?.id ?? null,
      date: displayDate,
      sessions: sessions
        .filter((session) => guide?.tasks.some((task) => task.id === session.taskId))
        .map(mapSession),
      guideTasks
    };
  }

  private async getLatestSubmission(taskId: string): Promise<LearningSubmission | null> {
    const row = (await this.db.select().from(learningSubmissions)
      .where(eq(learningSubmissions.taskId, taskId))
      .orderBy(desc(learningSubmissions.createdAt)).limit(1))[0];
    return row ? mapSubmission(row) : null;
  }

  private async getLatestEvaluation(submissionId: string): Promise<LearningEvaluation | null> {
    const row = (await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.submissionId, submissionId))
      .orderBy(desc(learningEvaluations.createdAt)).limit(1))[0];
    return row ? mapEvaluation(row) : null;
  }

  private async getSubmissionAttempts(taskId: string) {
    const rows = await this.db.select().from(learningSubmissions)
      .where(eq(learningSubmissions.taskId, taskId))
      .orderBy(desc(learningSubmissions.createdAt));
    const result = [];
    for (const row of rows) {
      const evaluations = await this.db.select().from(learningEvaluations)
        .where(eq(learningEvaluations.submissionId, row.id))
        .orderBy(desc(learningEvaluations.createdAt));
      result.push({
        submission: mapSubmission(row),
        evaluations: evaluations.map(mapEvaluation)
      });
    }
    return result;
  }
}
