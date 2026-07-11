import type { Id, LearningGoal, LearningRuntimeSnapshot, RoadmapStage, ShortPlanDay, DailyGuide, LearningSubmission, LearningEvaluation, StudySession, QuestionThread, QuestionMessage, PlanAdjustmentProposal, KnowledgeItem, KnowledgeItemStatus } from '../../shared/types';
import type { LearningAiOperation, BuiltLearningContext } from '../services/context-builder';

export interface ModuleStore {
  // Goals
  getGoal(goalId: Id): Promise<LearningGoal | null>;

  // Runtime snapshot
  getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot>;

  // Guides
  getActiveGuide(activeOnly?: boolean): Promise<{ goal: LearningGoal | null; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide | null }>;
  getCompletedGuidesForGoal(goalId: Id): Promise<DailyGuide[]>;

  // Short plan days
  getUsedShortPlanDayIds(goalId: Id): Promise<Set<string>>;
  activateShortPlanDay(shortPlanDayId: Id): Promise<boolean>;
  getActiveStageForGoal(goalId: Id): Promise<RoadmapStage | null>;
  getPendingShortPlanDaysForGoal(goalId: Id): Promise<ShortPlanDay[]>;
  updateShortPlanDay(shortPlanDayId: Id, patch: Partial<ShortPlanDay>): Promise<ShortPlanDay | null>;

  // Tasks
  getDailyGuideTasksByGuideId(guideId: Id): Promise<unknown[]>;
  completeAction(actionId: Id): Promise<void>;
  skipAction(actionId: Id, reason: string): Promise<void>;
  skipTask(taskId: Id): Promise<void>;

  // Sessions
  startSession(taskId: Id): Promise<StudySession>;
  pauseSession(sessionId: Id): Promise<StudySession>;
  completeSession(sessionId: Id): Promise<StudySession>;
  archiveTodayGuides(goalId: Id): Promise<void>;

  // Submissions & Evaluations
  getSubmissionsForTask(taskId: Id): Promise<LearningSubmission[]>;
  getEvaluationsForTask(taskId: Id): Promise<LearningEvaluation[]>;

  // Context
  buildContext(operation: LearningAiOperation, extra: Record<string, unknown>): Promise<BuiltLearningContext>;

  // Knowledge items
  recordKnowledgeItems(params: { goalId: Id; items: Array<{ key: string; summary: string; detail?: string; sourceType: KnowledgeItem['sourceType']; sourceId?: string }> }): Promise<KnowledgeItem[]>;
  resolveKnowledgeItems(goalId: Id, keys: string[]): Promise<void>;
  getKnowledgeItemsForGoal(params: { goalId: Id; status?: KnowledgeItemStatus; limit?: number }): Promise<KnowledgeItem[]>;

  // Branches
  openQuestionThread(kind: 'question' | 'debug' | 'practice', anchor: { taskId: Id; actionId: Id | null }): Promise<{ threadId: Id; kind: string; anchor: { taskId: Id; actionId: Id | null } }>;
  appendQuestionMessage(threadId: Id, role: 'user' | 'assistant', content: string): Promise<{ threadId: Id; messageId: Id; resolved: boolean }>;
  resolveQuestion(threadId: Id, summary: string): Promise<void>;
  promoteQuestionThread(threadId: Id, target: { taskId: Id }): Promise<void>;
  getQuestionThread(threadId: Id): Promise<QuestionThread | null>;
  getQuestionMessages(threadId: Id): Promise<QuestionMessage[]>;

  // Plan adjustments
  getPlanAdjustmentProposal(proposalId: Id): Promise<(PlanAdjustmentProposal & { items: Array<{ dayIndex: number; title: string; focus: string; expectedOutput: string; successCriteria: string; reason: string }> }) | null>;
  markPlanAdjustmentProposal(proposalId: Id, status: 'applied' | 'rejected'): Promise<void>;
}
