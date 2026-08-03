import type {
  DailyGuide,
  DailyGuideAction,
  DailyGuideTask,
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeQuestion,
  LearningEvaluation,
  LearningGoal,
  LearningRuntimeState,
  LearningSubmission,
  PlanAdjustmentProposal,
  PromptProfile,
  QuestionMessage,
  QuestionThread,
  RoadmapStage,
  NearTermPlanItem,
  StoredNextStepDecision,
  StudySession
} from '../../../shared/types';
import {
  conversationMessages,
  conversationThreads,
  currentLearningContext,
  focusSessions,
  goalIntakeMessages,
  goalIntakes,
  goals,
  learningActions,
  learningEvaluations,
  learningGuides,
  learningSubmissions,
  learningTasks,
  nearTermPlanItems,
  promptProfiles,
  roadmapStages
} from '../../db/schema';

export function mapGoal(row: typeof goals.$inferSelect): LearningGoal {
  return { ...row, sourceImportId: null };
}

export function mapGoalIntake(row: typeof goalIntakes.$inferSelect): GoalIntake {
  return {
    id: row.id,
    status: row.status,
    goalId: row.goalId,
    brief: row.briefJson ? parseGoalBrief(row.briefJson) : null,
    questions: row.questionsJson ? parseGoalIntakeQuestions(row.questionsJson) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt
  };
}

function parseGoalIntakeQuestions(raw: string): GoalIntakeQuestion[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is { prompt?: unknown; options?: unknown } => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        prompt: typeof item.prompt === 'string' ? item.prompt : '',
        options: Array.isArray(item.options)
          ? item.options.filter((option): option is string => typeof option === 'string')
          : []
      }))
      .filter((question) => question.prompt.length > 0);
  } catch {
    return [];
  }
}

export function mapGoalIntakeMessage(row: typeof goalIntakeMessages.$inferSelect): GoalIntakeMessage {
  return { ...row };
}

export function mapRoadmapStage(row: typeof roadmapStages.$inferSelect): RoadmapStage {
  return { ...row, status: row.status as RoadmapStage['status'] };
}

export function mapNearTermPlanItem(row: typeof nearTermPlanItems.$inferSelect): NearTermPlanItem {
  return {
    id: row.id,
    goalId: row.goalId,
    roadmapStageId: row.roadmapStageId,
    itemIndex: row.itemIndex,
    date: row.suggestedDate,
    sessionStatus: row.status,
    title: row.title,
    focus: row.focus,
    tasks: parseStringArray(row.tasksJson),
    expectedOutput: row.expectedOutput,
    successCriteria: row.successCriteria,
    locked: false,
    createdAt: row.createdAt
  };
}

export function mapDailyGuideAction(row: typeof learningActions.$inferSelect): DailyGuideAction {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    instruction: row.instruction,
    checkpoint: row.checkpoint,
    requirement: row.requirement,
    status: row.status,
    progressNote: row.progressNote,
    completedAt: row.completedAt,
    origin: row.origin,
    sourceAiReviewId: row.sourceAiReviewId,
    position: row.position
  };
}

export function mapDailyGuideTask(
  row: typeof learningTasks.$inferSelect,
  actions: DailyGuideAction[]
): DailyGuideTask {
  return {
    id: row.id,
    guideId: row.guideId,
    roadmapStageId: row.roadmapStageId,
    title: row.title,
    objective: row.objective,
    scope: row.scope,
    estimatedMinutes: {
      min: row.estimatedMinMinutes,
      target: row.estimatedTargetMinutes,
      max: row.estimatedMaxMinutes
    },
    actions,
    deliverable: row.deliverable,
    doneWhen: parseStringArray(row.doneWhenJson),
    quickHint: row.quickHint,
    evaluationMode: row.evaluationMode,
    status: row.status,
    closureKind: row.closureKind,
    closureReason: row.closureReason,
    nextStartPoint: row.nextStartPoint,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapDailyGuide(
  row: typeof learningGuides.$inferSelect,
  tasks: DailyGuideTask[] = []
): DailyGuide {
  const status: DailyGuide['status'] =
    row.status === 'active' ? 'confirmed' : row.status === 'closed' ? 'completed' : row.status;
  return {
    id: row.id,
    goalId: row.goalId,
    nearTermPlanItemId: row.nearTermPlanItemId,
    date: row.suggestedDate ?? row.createdAt.slice(0, 10),
    status,
    sessionStatus: row.status,
    weekFocus: row.weekFocus,
    todayGoal: row.learningGoal,
    deliverables: parseStringArray(row.deliverablesJson),
    boundaries: parseStringArray(row.boundariesJson),
    acceptanceCriteria: parseStringArray(row.acceptanceCriteriaJson),
    tomorrowActions: parseStringArray(row.nextActionsJson),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    tasks
  };
}

export function mapSession(row: typeof focusSessions.$inferSelect): StudySession {
  return {
    id: row.id,
    taskId: row.taskId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMinutes: row.status === 'ended' ? Math.floor(row.durationSeconds / 60) : null,
    status: row.status === 'ended' ? 'completed' : row.status,
    notes: row.notes
  };
}

export function mapRuntimeState(row: typeof currentLearningContext.$inferSelect): LearningRuntimeState {
  return {
    id: 'default',
    activeGoalId: row.goalId,
    activeStageId: null,
    activeDailyTaskId: row.taskId,
    activeStepId: row.actionId,
    activeQuestionThreadId: null,
    sessionStatus: 'idle',
    updatedAt: row.updatedAt
  };
}

export function mapQuestionThread(
  row: typeof conversationThreads.$inferSelect,
  anchor: { goalId?: string | null; taskId?: string | null; actionId?: string | null } = {}
): QuestionThread {
  return {
    id: row.id,
    goalId: anchor.goalId ?? null,
    stageId: null,
    taskId: anchor.taskId ?? null,
    stepId: anchor.actionId ?? null,
    status: row.status,
    question: row.question,
    resolutionSummary: row.resolutionSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt
  };
}

export function mapQuestionMessage(row: typeof conversationMessages.$inferSelect): QuestionMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt
  };
}

export function mapSubmission(row: typeof learningSubmissions.$inferSelect): LearningSubmission {
  return {
    id: row.id,
    taskId: row.taskId,
    stepId: row.stepId,
    dailyGuideActionId: row.stepId,
    sessionId: row.sessionId,
    content: row.content,
    evaluationStatus: (row.evaluationStatus ?? 'waiting') as LearningSubmission['evaluationStatus'],
    applicationStatus: null,
    applicationError: row.lastEvaluationError ?? null,
    appliedAt: row.lastEvaluationAt ?? null,
    createdAt: row.createdAt
  };
}

export function mapEvaluation(row: typeof learningEvaluations.$inferSelect): LearningEvaluation {
  const recommendation = parseObject(row.recommendationJson);
  return {
    id: row.id,
    submissionId: row.submissionId ?? '',
    stepId: null,
    result: row.result,
    evidence: parseStringArray(row.evidenceJson),
    correctParts: parseStringArray(row.correctPartsJson),
    misconceptions: parseStringArray(row.misconceptionsJson),
    missingRequirements: parseStringArray(row.missingRequirementsJson),
    feedback: row.feedback,
    recommendedAction: normalizeDecision(recommendation.action),
    decision: row.direction,
    selfNote: row.selfNote,
    recommendationDecision: row.recommendationDecision,
    recommendationDecisionReason: row.recommendationDecisionReason,
    applicationStatus: row.applicationStatus,
    applicationError: row.applicationError,
    appliedAt: row.appliedAt,
    source: row.source,
    supersedesEvaluationId: row.supersedesEvaluationId,
    correctionReason: row.correctionReason,
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

export function mapDecision(row: typeof learningEvaluations.$inferSelect): StoredNextStepDecision {
  const recommendation = parseObject(row.recommendationJson);
  return {
    id: `decision:${row.id}`,
    evaluationId: row.id,
    stepId: null,
    decision: normalizeDecision(recommendation.action),
    reason: typeof recommendation.reason === 'string' ? recommendation.reason : row.feedback,
    taskCompleted: recommendation.taskCompleted === true,
    nextStep: null,
    remediation: null,
    carryForward: row.selfNote,
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

export function mapPromptProfile(
  row: typeof promptProfiles.$inferSelect,
  version: number,
  content: string
): PromptProfile {
  return { ...row, version, content };
}

export function mapPlanAdjustmentProposal(row: typeof learningEvaluations.$inferSelect): PlanAdjustmentProposal {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: null,
    taskId: null,
    sourceDecisionId: null,
    status: row.recommendationDecision === 'accepted'
      ? 'accepted'
      : row.recommendationDecision === 'declined'
        ? 'rejected'
        : 'pending',
    reason: row.feedback,
    proposedChanges: parseObject(row.recommendationJson),
    appliedTaskId: null,
    createdAt: row.createdAt,
    decidedAt: row.recommendationDecision && row.recommendationDecision !== 'pending' ? row.createdAt : null,
    appliedAt: row.appliedAt
  };
}

export function parseGoalBrief(raw: string): GoalBrief {
  return JSON.parse(raw) as GoalBrief;
}

export function mergeGoalBrief(current: GoalBrief | null, patch: Partial<GoalBrief>): GoalBrief {
  return {
    title: patch.title ?? current?.title ?? '',
    targetOutcome: patch.targetOutcome ?? current?.targetOutcome ?? '',
    currentLevel: patch.currentLevel ?? current?.currentLevel ?? '',
    availableTime: patch.availableTime ?? current?.availableTime ?? '',
    deadline: patch.deadline ?? current?.deadline ?? '',
    depth: patch.depth ?? current?.depth ?? '',
    direction: patch.direction ?? current?.direction ?? '',
    constraints: patch.constraints ?? current?.constraints ?? [],
    successCriteria: patch.successCriteria ?? current?.successCriteria ?? []
  };
}

export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function addMinutesToClock(clock: string, minutes: number): string {
  const [hours = 0, mins = 0] = clock.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeDecision(value: unknown): StoredNextStepDecision['decision'] {
  const allowed = new Set([
    'advance',
    'explain_again',
    'remediate',
    'practice',
    'simplify',
    'complete_task',
    'request_user_decision'
  ]);
  return typeof value === 'string' && allowed.has(value)
    ? value as StoredNextStepDecision['decision']
    : 'request_user_decision';
}
