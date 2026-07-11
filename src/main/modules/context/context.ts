import type { LearningAiOperation, BuiltLearningContext } from '../../services/context-builder';
import type { KnowledgeItem } from '../../../shared/types';
import type { SubmissionEvaluationAgentOutput } from '../../../shared/schemas';
import type { StudyStore } from '../../services/store';

export interface FactProposal {
  sourceType: 'misconception' | 'weakness' | 'insight' | 'correction';
  key: string;
  summary: string;
  detail?: string;
  sourceId?: string;
}

export interface ProcessEvaluationParams {
  goalId: string;
  taskId?: string;
  submissionId: string;
  evaluationId: string;
  evaluationOutput: SubmissionEvaluationAgentOutput;
  taskDoneWhen?: string[];
  taskTitle?: string;
}

export class LearnerContextModule {
  constructor(private readonly store: StudyStore) {}

  build(operation: LearningAiOperation, extra: Record<string, unknown> = {}): Promise<BuiltLearningContext> {
    return this.store.buildContext(operation, extra);
  }

  async proposeFact(goalId: string, fact: FactProposal): Promise<void> {
    await this.store.recordKnowledgeItems({
      goalId,
      items: [{
        key: fact.key,
        summary: fact.summary,
        detail: fact.detail,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId
      }]
    });
  }

  async confirmFact(goalId: string, keys: string[]): Promise<void> {
    await this.store.resolveKnowledgeItems(goalId, keys);
  }

  async getFactsForGoal(goalId: string, status?: 'active' | 'resolved' | 'dormant'): Promise<KnowledgeItem[]> {
    return this.store.getKnowledgeItemsForGoal({ goalId, status });
  }

  async processEvaluationResult(params: ProcessEvaluationParams): Promise<void> {
    const { goalId, taskId, submissionId, evaluationId, evaluationOutput, taskDoneWhen, taskTitle } = params;

    if (evaluationOutput.misconceptions.length > 0 || evaluationOutput.missingRequirements.length > 0) {
      await this.store.recordKnowledgeItems({
        goalId,
        items: [
          ...evaluationOutput.misconceptions.map((m) => ({
            key: m.slice(0, 50),
            summary: m,
            sourceType: 'misconception' as const,
            sourceId: submissionId
          })),
          ...evaluationOutput.missingRequirements.map((m) => ({
            key: m.slice(0, 50),
            summary: m,
            sourceType: 'weakness' as const,
            sourceId: submissionId
          }))
        ]
      });
    }

    if (evaluationOutput.result === 'passed' && evaluationOutput.misconceptions.length === 0 && evaluationOutput.missingRequirements.length === 0) {
      const resolveKeys = [...(taskDoneWhen ?? []), taskTitle].filter(Boolean) as string[];
      if (resolveKeys.length > 0) {
        await this.store.resolveKnowledgeItems(goalId, resolveKeys);
      }
    }
  }
}
