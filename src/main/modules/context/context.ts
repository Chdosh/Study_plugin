import type { LearningAiOperation, BuiltLearningContext } from '../../services/context-builder';
import type { KnowledgeItem, LearnerFact, LearnerFactScope, LearnerFactSource } from '../../../shared/types';
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
}

export interface ProcessConversationEvaluationParams {
  goalId: string;
  taskId?: string;
  sourceId: string;
  correctParts: string[];
  misconceptions: string[];
}

export class LearnerContextModule {
  constructor(private readonly store: StudyStore) {}

  build(operation: LearningAiOperation, extra: Record<string, unknown> = {}): Promise<BuiltLearningContext> {
    return this.store.buildContext(operation, extra);
  }

  async proposeFact(goalId: string, fact: { scope: LearnerFactScope; taskId?: string; key: string; value: string; source: LearnerFactSource; confidence?: number }): Promise<LearnerFact> {
    return this.store.proposeFact(goalId, fact);
  }

  async confirmFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string): Promise<LearnerFact> {
    const existing = await this.store.getFact(goalId, key, scope, taskId);
    if (!existing || !existing.value.trim()) {
      throw new Error('无法确认不存在或内容为空的学习事实。请先提供具体内容。');
    }
    return this.store.proposeFact(goalId, { scope, taskId, key, value: existing.value, source: 'confirmed', confidence: 1 });
  }

  async getFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string): Promise<LearnerFact | null> {
    return this.store.getFact(goalId, key, scope, taskId);
  }

  async listFactsForGoal(goalId: string, scope?: LearnerFactScope): Promise<LearnerFact[]> {
    return this.store.listFactsForGoal(goalId, scope);
  }

  async deleteFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string): Promise<void> {
    return this.store.deleteFact(goalId, key, scope, taskId);
  }

  async getFactsForGoal(goalId: string, status?: 'active' | 'resolved' | 'dormant'): Promise<KnowledgeItem[]> {
    return this.store.getKnowledgeItemsForGoal({ goalId, status });
  }

  async processEvaluationResult(params: ProcessEvaluationParams): Promise<void> {
    const { goalId, taskId, submissionId, evaluationId, evaluationOutput } = params;

    if (
      evaluationOutput.correctParts.length > 0
      || evaluationOutput.misconceptions.length > 0
      || evaluationOutput.missingRequirements.length > 0
    ) {
      await this.store.recordKnowledgeItems({
        goalId,
        items: [
          ...evaluationOutput.correctParts.map((part) => ({
            key: part.slice(0, 50),
            summary: part,
            sourceType: 'insight' as const,
            sourceId: `${submissionId}:correct:${part.slice(0, 24)}`,
            evidence: { submissionId, evaluationId, taskId }
          })),
          ...evaluationOutput.misconceptions.map((m) => ({
            key: m.slice(0, 50),
            summary: m,
            sourceType: 'misconception' as const,
            sourceId: `${submissionId}:misconception:${m.slice(0, 24)}`,
            evidence: { submissionId, evaluationId, taskId }
          })),
          ...evaluationOutput.missingRequirements.map((m) => ({
            key: m.slice(0, 50),
            summary: m,
            sourceType: 'weakness' as const,
            sourceId: `${submissionId}:weakness:${m.slice(0, 24)}`,
            evidence: { submissionId, evaluationId, taskId }
          }))
        ]
      });
    }
  }

  async processConversationEvaluation(
    params: ProcessConversationEvaluationParams
  ): Promise<void> {
    const items = [
      ...params.misconceptions.slice(0, 3).map((summary) => ({
        key: summary.slice(0, 50),
        summary,
        sourceType: 'misconception' as const,
        sourceId: params.sourceId,
        evidence: { taskId: params.taskId }
      })),
      ...params.correctParts.slice(0, 3).map((summary) => ({
        key: summary.slice(0, 50),
        summary,
        sourceType: 'insight' as const,
        sourceId: params.sourceId,
        evidence: { taskId: params.taskId }
      }))
    ];
    if (items.length > 0) {
      await this.store.recordKnowledgeItems({
        goalId: params.goalId,
        items
      });
    }
  }
}
