import type { LearningRuntimeSnapshot } from '../../shared/types';
import type { StudyStore } from './store';

export type LearningAiOperation =
  | 'generate_daily_plan'
  | 'generate_stage_outline'
  | 'teach_step'
  | 'answer_step_question'
  | 'evaluate_submission'
  | 'decide_next_step'
  | 'summarize_step';

export interface BuiltLearningContext {
  operation: LearningAiOperation;
  snapshot: LearningRuntimeSnapshot;
  context: Record<string, unknown>;
  contextSourceIds: string[];
}

export class ContextBuilder {
  constructor(private readonly store: StudyStore) {}

  async build(operation: LearningAiOperation, extra: Record<string, unknown> = {}): Promise<BuiltLearningContext> {
    const snapshot = await this.store.getLearningRuntimeSnapshot();
    const contextSourceIds = collectSourceIds(snapshot);
    const context: Record<string, unknown> = {
      operation,
      goal: snapshot.goal
        ? {
            id: snapshot.goal.id,
            title: snapshot.goal.title,
            description: snapshot.goal.description,
            status: snapshot.goal.status
          }
        : null,
      guide: snapshot.dailyGuide
        ? {
            id: snapshot.dailyGuide.id,
            date: snapshot.dailyGuide.date,
            todayGoal: snapshot.dailyGuide.todayGoal,
            status: snapshot.dailyGuide.status
          }
        : null,
      guideTask: snapshot.dailyGuideTask
        ? {
            id: snapshot.dailyGuideTask.id,
            title: snapshot.dailyGuideTask.title,
            objective: snapshot.dailyGuideTask.objective,
            scope: snapshot.dailyGuideTask.scope,
            deliverable: snapshot.dailyGuideTask.deliverable,
            doneWhen: snapshot.dailyGuideTask.doneWhen,
            quickHint: snapshot.dailyGuideTask.quickHint,
            evaluationMode: snapshot.dailyGuideTask.evaluationMode,
            status: snapshot.dailyGuideTask.status
          }
        : null,
      guideAction: snapshot.dailyGuideAction
        ? {
            id: snapshot.dailyGuideAction.id,
            title: snapshot.dailyGuideAction.title,
            instruction: snapshot.dailyGuideAction.instruction,
            checkpoint: snapshot.dailyGuideAction.checkpoint,
            status: snapshot.dailyGuideAction.status
          }
        : null,
      roadmapStage: snapshot.roadmapStage
        ? {
            id: snapshot.roadmapStage.id,
            title: snapshot.roadmapStage.title,
            objective: snapshot.roadmapStage.objective,
            successCriteria: snapshot.roadmapStage.successCriteria
          }
        : null,
      currentQuestionThread: snapshot.questionThread
        ? {
            id: snapshot.questionThread.id,
            question: snapshot.questionThread.question,
            status: snapshot.questionThread.status,
            resolutionSummary: snapshot.questionThread.resolutionSummary,
            messages: snapshot.questionMessages.slice(-4)
          }
        : null,
      latestSubmission: snapshot.latestSubmission
        ? {
            id: snapshot.latestSubmission.id,
            content: snapshot.latestSubmission.content,
            createdAt: snapshot.latestSubmission.createdAt
          }
        : null,
      latestEvaluation: snapshot.latestEvaluation,
      latestDecision: snapshot.latestDecision,
      pendingAdjustment: snapshot.pendingAdjustment,
      ...extra
    };

    return {
      operation,
      snapshot,
      context,
      contextSourceIds
    };
  }
}

function collectSourceIds(snapshot: LearningRuntimeSnapshot): string[] {
  return [
    snapshot.goal?.id,
    snapshot.dailyGuide?.id,
    snapshot.dailyGuideTask?.id,
    snapshot.dailyGuideAction?.id,
    snapshot.roadmapStage?.id,
    snapshot.questionThread?.id,
    snapshot.latestSubmission?.id,
    snapshot.latestEvaluation?.id,
    snapshot.latestDecision?.id,
    snapshot.pendingAdjustment?.id
  ].filter((value): value is string => Boolean(value));
}