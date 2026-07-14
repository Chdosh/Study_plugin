import type {
  DailyPlanBlock,
  DailyGuide,
  DailyGuideAction,
  DailyGuideBlock,
  DailyGuideTask,
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningEvaluation,
  LearningGoal,
  LearningRuntimeSnapshot,
  LearningRuntimeState,
  LearningStep,
  LearningSubmission,
  LearningSummary,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PlanStage,
  PreviousLearningDayResult,
  PromptProfile,
  QuestionMessage,
  QuestionThread,
  ReviewResult,
  RoadmapStage,
  ShortPlanDay,
  StoredNextStepDecision,
  StudySession,
  StudyWindow,
  TaskItem
} from '../../../shared/types';
import {
  aiReviews,
  appSettings,
  dailyGuideActions,
  generationLocks,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  focusEvents,
  goalIntakeMessages,
  goalIntakes,
  goals,
  knowledgeItems,
  learningEvaluations,
  learningRuntimeStates,
  learningSteps,
  learningSubmissions,
  learningSummaries,
  nextStepDecisions,
  planAdjustmentProposals,
  planVersions,
  planStages,
  promptProfiles,
  promptVersions,
  questionMessages,
  questionThreads,
  roadmapStages,
  shortPlanDays,
  studySessions,
  taskItems
} from '../../db/schema';

export function mapTask(row: typeof taskItems.$inferSelect): TaskItem {
  return {
    id: row.id,
    goalId: row.goalId,
    sourceImportId: row.sourceImportId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    difficulty: row.difficulty,
    estimateMinutes: row.estimateMinutes,
    acceptanceCriteria: row.acceptanceCriteria,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapGoal(row: typeof goals.$inferSelect): LearningGoal {
  return {
    id: row.id,
    sourceImportId: row.sourceImportId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapGoalIntake(row: typeof goalIntakes.$inferSelect): GoalIntake {
  return {
    id: row.id,
    status: row.status,
    goalId: row.goalId,
    brief: row.briefJson ? parseGoalBrief(row.briefJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt
  };
}

export function mapGoalIntakeMessage(row: typeof goalIntakeMessages.$inferSelect): GoalIntakeMessage {
  return {
    id: row.id,
    intakeId: row.intakeId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt
  };
}

export function mapRoadmapStage(row: typeof roadmapStages.$inferSelect): RoadmapStage {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    objective: row.objective,
    direction: row.direction,
    successCriteria: row.successCriteria,
    status: (row.status ?? 'pending') as RoadmapStage['status'],
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapShortPlanDay(row: typeof shortPlanDays.$inferSelect): ShortPlanDay {
  return {
    id: row.id,
    goalId: row.goalId,
    roadmapStageId: row.roadmapStageId ?? null,
    dayIndex: row.dayIndex,
    date: row.date,
    sessionStatus: (row.sessionStatus ?? 'pending') as ShortPlanDay['sessionStatus'],
    title: row.title,
    focus: row.focus,
    tasks: parseStringArray(row.tasksJson),
    expectedOutput: row.expectedOutput,
    successCriteria: row.successCriteria,
    locked: row.locked ?? false,
    createdAt: row.createdAt
  };
}

export function mapStage(row: typeof planStages.$inferSelect): PlanStage {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    objective: row.objective,
    prerequisites: row.prerequisites,
    successCriteria: row.successCriteria,
    status: row.status,
    position: row.position,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapDailyGuide(row: typeof dailyGuides.$inferSelect, blocks: DailyGuideBlock[], tasks: DailyGuideTask[] = []): DailyGuide {
  return {
    id: row.id,
    goalId: row.goalId,
    planId: row.planId,
    shortPlanDayId: row.shortPlanDayId ?? null,
    date: row.date,
    status: row.status,
    sessionStatus: (row.sessionStatus ?? 'active') as DailyGuide['sessionStatus'],
    weekFocus: row.weekFocus,
    todayGoal: row.todayGoal,
    deliverables: parseStringArray(row.deliverablesJson),
    boundaries: parseStringArray(row.boundariesJson),
    acceptanceCriteria: parseStringArray(row.acceptanceCriteriaJson),
    tomorrowActions: parseStringArray(row.tomorrowActionsJson),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    tasks,
    blocks
  };
}

export function mapDailyGuideTask(row: typeof dailyGuideTasks.$inferSelect, actions: DailyGuideAction[]): DailyGuideTask {
  const completedActions = actions.filter((action) => action.status === 'done').map((action) => action.id);
  const remainingActions = actions.filter((action) => action.status !== 'done').map((action) => action.id);
  const currentAction = actions.find((action) => action.id === row.currentActionId) ?? actions.find((action) => action.status !== 'done') ?? null;
  return {
    id: row.id,
    guideId: row.guideId,
    roadmapStageId: row.roadmapStageId ?? null,
    legacyPlanBlockId: row.legacyPlanBlockId,
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
    submissionPolicy: row.submissionPolicy,
    carryoverAllowed: row.carryoverAllowed,
    status: row.status,
    progressPercent: row.progressPercent,
    completedActions,
    remainingActions,
    currentAction,
    nextStartPoint: row.nextStartPoint,
    totalElapsedMinutes: row.totalElapsedMinutes,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapDailyGuideAction(row: typeof dailyGuideActions.$inferSelect): DailyGuideAction {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    instruction: row.instruction,
    checkpoint: row.checkpoint,
    status: row.status,
    progressNote: row.progressNote,
    completedAt: row.completedAt,
    position: row.position
  };
}

export function mapDailyGuideBlock(row: typeof dailyGuideBlocks.$inferSelect, planBlock: DailyPlanBlock): DailyGuideBlock {
  return {
    id: row.id,
    guideId: row.guideId,
    planBlockId: row.planBlockId,
    title: row.title,
    startTime: planBlock.startTime,
    endTime: planBlock.endTime,
    durationMinutes: planBlock.durationMinutes,
    objective: planBlock.objective,
    action: planBlock.action,
    expectedOutput: planBlock.expectedOutput,
    successCriteria: planBlock.successCheck,
    fallback: planBlock.fallback,
    status: planBlock.status,
    position: row.position
  };
}

export function mapPlanBlock(row: typeof dailyPlanBlocks.$inferSelect): DailyPlanBlock {
  return {
    id: row.id,
    planId: row.planId,
    taskId: row.taskId,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    objective: row.objective,
    action: row.action,
    expectedOutput: row.expectedOutput,
    difficulty: row.difficulty,
    material: row.material,
    successCheck: row.successCheck,
    fallback: row.fallback,
    status: row.status,
    position: row.position
  };
}

export function mapSession(row: typeof studySessions.$inferSelect): StudySession {
  return {
    id: row.id,
    taskId: row.taskId,
    taskItemsId: row.taskItemsId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
    focusScore: row.focusScore,
    notes: row.notes
  };
}

export function mapLearningStep(row: typeof learningSteps.$inferSelect): LearningStep {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: row.stageId,
    taskId: row.taskId,
    blockId: row.blockId,
    title: row.title,
    objective: row.objective,
    instruction: row.instruction,
    expectedOutput: row.expectedOutput,
    successCriteria: row.successCriteria,
    status: row.status,
    attempt: row.attempt,
    position: row.position,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapRuntimeState(row: typeof learningRuntimeStates.$inferSelect): LearningRuntimeState {
  return {
    id: 'default',
    activeGoalId: row.activeGoalId,
    activeStageId: row.activeStageId,
    activeDailyTaskId: row.activeDailyTaskId,
    activeStepId: row.activeStepId,
    activeQuestionThreadId: row.activeQuestionThreadId,
    sessionStatus: row.sessionStatus,
    updatedAt: row.updatedAt
  };
}

export function mapQuestionThread(row: typeof questionThreads.$inferSelect): QuestionThread {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: row.stageId,
    taskId: row.taskId,
    stepId: row.stepId,
    status: row.status,
    question: row.question,
    resolutionSummary: row.resolutionSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt
  };
}

export function mapQuestionMessage(row: typeof questionMessages.$inferSelect): QuestionMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt
  };
}

export function mapSubmission(row: { id: string; stepId: string | null; dailyGuideActionId?: string | null; sessionId: string | null; content: string; createdAt: string; evaluationStatus?: string | null; applicationStatus?: string | null; applicationError?: string | null; appliedAt?: string | null }): LearningSubmission {
  return {
    id: row.id,
    stepId: row.stepId,
    dailyGuideActionId: row.dailyGuideActionId ?? null,
    sessionId: row.sessionId,
    content: row.content,
    evaluationStatus: (row.evaluationStatus ?? 'completed') as LearningSubmission['evaluationStatus'],
    applicationStatus: (row.applicationStatus ?? 'applied') as LearningSubmission['applicationStatus'],
    applicationError: row.applicationError ?? null,
    appliedAt: row.appliedAt ?? null,
    createdAt: row.createdAt
  };
}

export function mapEvaluation(row: typeof learningEvaluations.$inferSelect): LearningEvaluation {
  return {
    id: row.id,
    submissionId: row.submissionId,
    stepId: row.stepId ?? null,
    result: row.result,
    mastery: row.mastery,
    evidence: parseStringArray(row.evidenceJson),
    correctParts: parseStringArray(row.correctPartsJson),
    misconceptions: parseStringArray(row.misconceptionsJson),
    missingRequirements: parseStringArray(row.missingRequirementsJson),
    feedback: row.feedback,
    recommendedAction: row.recommendedAction,
    decision: (row.decision ?? 'stay') as LearningEvaluation['decision'],
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

export function mapDecision(row: typeof nextStepDecisions.$inferSelect): StoredNextStepDecision {
  return {
    id: row.id,
    evaluationId: row.evaluationId,
    stepId: row.stepId ?? null,
    decision: row.decision,
    reason: row.reason,
    taskCompleted: row.taskCompleted,
    nextStep: row.nextStepJson ? JSON.parse(row.nextStepJson) : null,
    remediation: row.remediationJson ? JSON.parse(row.remediationJson) : null,
    carryForward: row.carryForward,
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

export function mapLearningSummary(row: typeof learningSummaries.$inferSelect): LearningSummary {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    status: row.status,
    summary: JSON.parse(row.summaryJson),
    createdAt: row.createdAt
  };
}

export function mapPlanAdjustmentProposal(row: typeof planAdjustmentProposals.$inferSelect): PlanAdjustmentProposal {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: row.stageId,
    taskId: row.taskId,
    sourceDecisionId: row.sourceDecisionId,
    status: row.status,
    reason: row.reason,
    proposedChanges: JSON.parse(row.proposedChangesJson),
    appliedTaskId: row.appliedTaskId,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    appliedAt: row.appliedAt
  };
}

export function mergeGoalBrief(current: GoalBrief | null, patch: Partial<GoalBrief>): GoalBrief {
  return {
    title: patch.title ?? current?.title ?? '',
    targetOutcome: patch.targetOutcome ?? current?.targetOutcome ?? '先完成一个可执行的学习目标',
    currentLevel: patch.currentLevel ?? current?.currentLevel ?? '未明确',
    availableTime: patch.availableTime ?? current?.availableTime ?? '未明确',
    deadline: patch.deadline ?? current?.deadline ?? '未明确',
    constraints: patch.constraints ?? current?.constraints ?? [],
    successCriteria: patch.successCriteria ?? current?.successCriteria ?? []
  };
}

export function parseGoalBrief(raw: string): GoalBrief {
  try {
    const record = JSON.parse(raw) as Partial<GoalBrief>;
    return mergeGoalBrief(null, {
      title: typeof record.title === 'string' ? record.title : '',
      targetOutcome: typeof record.targetOutcome === 'string' ? record.targetOutcome : undefined,
      currentLevel: typeof record.currentLevel === 'string' ? record.currentLevel : undefined,
      availableTime: typeof record.availableTime === 'string' ? record.availableTime : undefined,
      deadline: typeof record.deadline === 'string' ? record.deadline : undefined,
      constraints: Array.isArray(record.constraints) ? record.constraints.map(String) : [],
      successCriteria: Array.isArray(record.successCriteria) ? record.successCriteria.map(String) : []
    });
  } catch {
    return mergeGoalBrief(null, {});
  }
}

export function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function addMinutesToClock(clock: string, minutes: number): string {
  const [rawHour, rawMinute] = clock.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return clock;
  }
  const total = hour * 60 + minute + minutes;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextHour = Math.floor(normalized / 60);
  const nextMinute = normalized % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

export function readProposedChanges(value: unknown): {
  carryForward: string;
  recommendedAction: string;
  missingRequirements: string[];
  misconceptions: string[];
  nextFocus: string;
} {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    carryForward: typeof record.carryForward === 'string' ? record.carryForward : '',
    recommendedAction: typeof record.recommendedAction === 'string' ? record.recommendedAction : '',
    missingRequirements: Array.isArray(record.missingRequirements) ? record.missingRequirements.map(String) : [],
    misconceptions: Array.isArray(record.misconceptions) ? record.misconceptions.map(String) : [],
    nextFocus: typeof record.nextFocus === 'string' ? record.nextFocus : ''
  };
}

export function difficultyFromRecommendedAction(action: string): TaskItem['difficulty'] {
  if (action === 'exam') return 'exam';
  if (action === 'simplify' || action === 'remediate') return 'foundation';
  if (action === 'practice') return 'standard';
  return 'foundation';
}

export function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
