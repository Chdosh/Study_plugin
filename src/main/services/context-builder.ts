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
      stage: snapshot.stage
        ? {
            id: snapshot.stage.id,
            title: snapshot.stage.title,
            objective: snapshot.stage.objective,
            successCriteria: snapshot.stage.successCriteria,
            summary: snapshot.stage.summary
          }
        : null,
      task: snapshot.task
        ? {
            id: snapshot.task.id,
            title: snapshot.task.title,
            description: snapshot.task.description,
            acceptanceCriteria: snapshot.task.acceptanceCriteria,
            difficulty: snapshot.task.difficulty
          }
        : null,
      block: snapshot.block
        ? {
            id: snapshot.block.id,
            objective: snapshot.block.objective,
            action: snapshot.block.action,
            expectedOutput: snapshot.block.expectedOutput,
            successCheck: snapshot.block.successCheck,
            fallback: snapshot.block.fallback,
            durationMinutes: snapshot.block.durationMinutes
          }
        : null,
      step: snapshot.step
        ? {
            id: snapshot.step.id,
            title: snapshot.step.title,
            objective: snapshot.step.objective,
            instruction: snapshot.step.instruction,
            expectedOutput: snapshot.step.expectedOutput,
            successCriteria: snapshot.step.successCriteria,
            status: snapshot.step.status,
            attempt: snapshot.step.attempt
          }
        : null,
      recentStepSummaries: snapshot.recentStepSummaries.slice(0, 3),
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
    snapshot.stage?.id,
    snapshot.task?.id,
    snapshot.block?.id,
    snapshot.step?.id,
    snapshot.questionThread?.id,
    ...snapshot.recentStepSummaries.map((summary) => summary.id),
    snapshot.latestSubmission?.id,
    snapshot.latestEvaluation?.id,
    snapshot.latestDecision?.id,
    snapshot.pendingAdjustment?.id
  ].filter((value): value is string => Boolean(value));
}
