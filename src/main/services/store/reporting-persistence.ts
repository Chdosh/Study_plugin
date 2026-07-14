import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { DailyGuide, LearningEvaluation, LearningSubmission } from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  goals,
  knowledgeItems,
  learningEvaluations,
  learningSteps,
  learningSubmissions,
  questionThreads,
  roadmapStages,
  shortPlanDays,
  studySessions
} from '../../db/schema';
import {
  mapEvaluation,
  mapLearningStep,
  mapSession,
  mapSubmission
} from './serialization';

type GetGuideByDate = (date: string) => Promise<DailyGuide | null>;

export class ReportingPersistence {
  constructor(
    private readonly db: Database,
    private readonly getGuideByDate: GetGuideByDate
  ) {}

  async exportGoalData(goalId: string): Promise<Record<string, unknown>> {
    const [goalRows, stageRows, shortPlanRows, guideRows, knowledgeRows] = await Promise.all([
      this.db.select().from(goals).where(eq(goals.id, goalId)),
      this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goalId)),
      this.db.select().from(shortPlanDays).where(eq(shortPlanDays.goalId, goalId)),
      this.db.select().from(dailyGuides).where(eq(dailyGuides.goalId, goalId)),
      this.db.select().from(knowledgeItems).where(eq(knowledgeItems.goalId, goalId))
    ]);
    const dailyPlanIds = [...new Set(guideRows.map((r) => r.planId).filter(Boolean))];
    const taskRows = guideRows.length > 0
      ? await this.db.select().from(dailyGuideTasks).where(inArray(dailyGuideTasks.guideId, guideRows.map((r) => r.id)))
      : [];
    const taskIds = taskRows.map((r) => r.id);
    const actionRows = taskIds.length > 0
      ? await this.db.select().from(dailyGuideActions).where(inArray(dailyGuideActions.taskId, taskIds))
      : [];
    const actionIds = actionRows.map((r) => r.id);
    const submissionRows = actionIds.length > 0
      ? await this.db.select().from(learningSubmissions).where(inArray(learningSubmissions.dailyGuideActionId, actionIds))
      : [];
    const evaluationRows = submissionRows.length > 0
      ? await this.db.select().from(learningEvaluations).where(inArray(learningEvaluations.submissionId, submissionRows.map((r) => r.id)))
      : [];
    const blockRows = dailyPlanIds.length > 0
      ? await this.db.select().from(dailyPlanBlocks).where(inArray(dailyPlanBlocks.planId, dailyPlanIds))
      : [];
    const planRows = dailyPlanIds.length > 0
      ? await this.db.select().from(dailyPlans).where(inArray(dailyPlans.id, dailyPlanIds))
      : [];
    const sessionRows = taskIds.length > 0
      ? await this.db.select().from(studySessions).where(inArray(studySessions.taskId, taskIds))
      : [];
    const questionRows = actionIds.length > 0
      ? await this.db.select().from(questionThreads).where(inArray(questionThreads.dailyGuideActionId, actionIds))
      : [];
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      goal: goalRows[0] ?? null,
      roadmapStages: stageRows,
      shortPlanDays: shortPlanRows,
      dailyGuides: guideRows,
      dailyPlans: planRows,
      dailyGuideTasks: taskRows,
      dailyGuideActions: actionRows,
      dailyPlanBlocks: blockRows,
      studySessions: sessionRows,
      knowledgeItems: knowledgeRows,
      submissions: submissionRows,
      evaluations: evaluationRows,
      questionThreads: questionRows
    };
  }

  async getDaySnapshot(date: string) {
    const sessions = await this.db.select().from(studySessions).orderBy(desc(studySessions.startedAt));
    const guide = await this.getGuideByDate(date);
    const guideTasks = [];
    for (const guideTask of guide?.tasks ?? []) {
      const taskSessions = sessions
        .filter((session) => session.taskId && session.taskId === guideTask.id)
        .map(mapSession);
      const steps = guideTask.legacyPlanBlockId
        ? await this.db
            .select()
            .from(learningSteps)
            .where(eq(learningSteps.blockId, guideTask.legacyPlanBlockId))
            .orderBy(asc(learningSteps.position))
        : [];
      const latestStep = steps.length > 0 ? mapLearningStep(steps[steps.length - 1]) : null;
      const latestSubmission = latestStep ? await this.getLatestSubmission(latestStep.id) : null;
      const latestEvaluation = latestStep ? await this.getLatestEvaluation(latestStep.id) : null;
      const actionIds = guideTask.actions.map((action) => action.id);
      const questionRows = actionIds.length > 0
        ? await this.db.select().from(questionThreads).where(inArray(questionThreads.dailyGuideActionId, actionIds))
        : [];
      guideTasks.push({
        id: guideTask.id,
        title: guideTask.title,
        status: guideTask.status,
        progressPercent: guideTask.progressPercent,
        estimatedMinutes: guideTask.estimatedMinutes,
        totalElapsedMinutes: guideTask.totalElapsedMinutes,
        focusSessions: taskSessions.map((session) => ({
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          elapsedMinutes: session.durationMinutes,
          pauseReason: session.notes,
          progressNote: session.notes
        })),
        finalSubmission: latestSubmission,
        evaluation: latestEvaluation,
        incompleteActions: guideTask.actions.filter((action) => action.status !== 'done').map((action) => ({
          title: action.title,
          checkpoint: action.checkpoint,
          progressNote: action.progressNote
        })),
        questionTopics: questionRows.map((question) => question.question),
        nextStartPoint: guideTask.nextStartPoint
      });
    }
    return {
      date,
      sessions: sessions.map(mapSession),
      guideTasks
    };
  }

  private async getLatestSubmission(stepId: string): Promise<LearningSubmission | null> {
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(eq(learningSubmissions.stepId, stepId))
      .orderBy(desc(learningSubmissions.createdAt))
      .limit(1);
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  private async getLatestEvaluation(stepId: string): Promise<LearningEvaluation | null> {
    const rows = await this.db
      .select()
      .from(learningEvaluations)
      .where(eq(learningEvaluations.stepId, stepId))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    return rows[0] ? mapEvaluation(rows[0]) : null;
  }
}
