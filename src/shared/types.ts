export type Id = string;

export type PromptProfileKey = 'foundation' | 'standard' | 'advanced' | 'exam' | 'recovery';

export interface AppSettings {
  deepseekBaseUrl: string;
  deepseekModel: string;
  hasDeepseekApiKey: boolean;
  autoLaunch: boolean;
  defaultBlockMinutes: number;
  dailyStudyWindows: StudyWindow[];
}

export interface StudyWindow {
  start: string;
  end: string;
}

export interface TaskItem {
  id: Id;
  goalId: Id | null;
  sourceImportId: Id | null;
  title: string;
  description: string | null;
  status: 'backlog' | 'planned' | 'in_progress' | 'done' | 'skipped';
  priority: number;
  difficulty: 'foundation' | 'standard' | 'advanced' | 'exam';
  estimateMinutes: number;
  acceptanceCriteria: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningGoal {
  id: Id;
  sourceImportId: Id | null;
  title: string;
  description: string | null;
  status: 'active' | 'done' | 'archived';
  priority: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalBrief {
  title: string;
  targetOutcome: string;
  currentLevel: string;
  availableTime: string;
  deadline: string;
  constraints: string[];
  successCriteria: string[];
}

export interface GoalIntake {
  id: Id;
  status: 'collecting' | 'ready' | 'confirmed';
  goalId: Id | null;
  brief: GoalBrief | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface GoalIntakeMessage {
  id: Id;
  intakeId: Id;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface GoalIntakeState {
  intake: GoalIntake;
  messages: GoalIntakeMessage[];
  activeGoal: LearningGoal | null;
}

export interface HistoryIntakeSummary {
  intake: GoalIntake;
  goalTitle: string;
  messageCount: number;
}

export type RoadmapStageStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'adjusted';

export interface RoadmapStage {
  id: Id;
  goalId: Id;
  title: string;
  objective: string;
  direction: string;
  successCriteria: string;
  status: RoadmapStageStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type ShortPlanDayStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface ShortPlanDay {
  id: Id;
  goalId: Id;
  roadmapStageId: string | null;
  dayIndex: number;
  date: string | null;
  sessionStatus: ShortPlanDayStatus;
  title: string;
  focus: string;
  tasks: string[];
  expectedOutput: string;
  successCriteria: string;
  locked: boolean;
  createdAt: string;
}

export interface GenerateRollingPlanResult {
  goal: LearningGoal;
  roadmap: RoadmapStage[];
  shortPlan: ShortPlanDay[];
  guide: DailyGuide;
  activatedStage: RoadmapStage | null;
}

export type KnowledgeItemSourceType = 'misconception' | 'weakness' | 'insight' | 'correction';
export type KnowledgeItemStatus = 'active' | 'resolved' | 'dormant';

export interface KnowledgeItem {
  id: Id;
  goalId: string | null;
  key: string;
  summary: string;
  detail: string | null;
  sourceType: KnowledgeItemSourceType;
  sourceId: string | null;
  occurrenceCount: number;
  lastSeenAt: string | null;
  status: KnowledgeItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DailyGuideBlock {
  id: Id;
  guideId: Id;
  planBlockId: Id;
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  objective: string;
  action: string;
  expectedOutput: string;
  successCriteria: string;
  fallback: string;
  status: DailyPlanBlock['status'];
  position: number;
}

export interface EstimatedMinutes {
  min: number;
  target: number;
  max: number;
}

export type DailyGuideTaskStatus = 'planned' | 'active' | 'done' | 'skipped' | 'deferred';
export type DailyGuideActionStatus = 'planned' | 'done' | 'skipped';

export interface DailyGuideAction {
  id: Id;
  taskId: Id;
  title: string;
  instruction: string;
  checkpoint: string;
  status: DailyGuideActionStatus;
  progressNote: string | null;
  completedAt: string | null;
  position: number;
}

export interface DailyGuideTask {
  id: Id;
  guideId: Id;
  roadmapStageId: Id | null;
  legacyPlanBlockId: Id | null;
  title: string;
  objective: string;
  scope: string;
  estimatedMinutes: EstimatedMinutes;
  actions: DailyGuideAction[];
  deliverable: string;
  doneWhen: string[];
  quickHint: string;
  evaluationMode: 'local' | 'ai';
  submissionPolicy: 'once_after_task';
  carryoverAllowed: boolean;
  status: DailyGuideTaskStatus;
  progressPercent: number;
  completedActions: Id[];
  remainingActions: Id[];
  currentAction: DailyGuideAction | null;
  nextStartPoint: string | null;
  totalElapsedMinutes: number;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyGuide {
  id: Id;
  goalId: Id;
  planId: Id;
  shortPlanDayId: string | null;
  date: string;
  status: 'draft' | 'confirmed' | 'completed' | 'archived';
  sessionStatus: 'draft' | 'active' | 'closed';
  weekFocus: string;
  todayGoal: string;
  deliverables: string[];
  boundaries: string[];
  acceptanceCriteria: string[];
  tomorrowActions: string[];
  createdAt: string;
  confirmedAt: string | null;
  tasks: DailyGuideTask[];
  blocks: DailyGuideBlock[];
}

export interface LayeredPlanResult {
  goal: LearningGoal;
  roadmap: RoadmapStage[];
  shortPlan: ShortPlanDay[];
  guide: DailyGuide;
}

export type TodayState =
  | 'needs_goal'
  | 'ready_to_generate'
  | 'generating'
  | 'generation_failed'
  | 'active'
  | 'completed'
  | 'plan_exhausted';

export interface TodayGuideState {
  goal: LearningGoal | null;
  roadmap: RoadmapStage[];
  shortPlan: ShortPlanDay[];
  guide: DailyGuide | null;
  todayState: TodayState;
  pendingEvaluations?: string[];
}

export interface PreviousLearningDayResult {
  completedTasks: string[];
  evaluationSummary: string;
  reviewSummary?: string;
}

export interface PrepareCurrentLearningDayResult {
  todayState: TodayState;
  result?: LayeredPlanResult;
  errorMessage?: string;
}

export interface StartNextSessionResult extends PrepareCurrentLearningDayResult {
  review: ReviewResult | null;
}

export interface PlanStage {
  id: Id;
  goalId: Id;
  title: string;
  objective: string;
  prerequisites: string | null;
  successCriteria: string;
  status: 'proposed' | 'confirmed' | 'active' | 'completed' | 'skipped';
  position: number;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyPlanBlock {
  id: Id;
  planId: Id;
  taskId: Id | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  objective: string;
  action: string;
  expectedOutput: string;
  difficulty: string;
  material: string;
  successCheck: string;
  fallback: string;
  status: 'planned' | 'active' | 'done' | 'skipped' | 'deferred';
  position: number;
}

export interface StudySession {
  id: Id;
  taskId: Id | null;
  taskItemsId: Id | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  status: 'active' | 'paused' | 'completed' | 'skipped';
  focusScore: number | null;
  notes: string | null;
}

export type LearningStepStatus =
  | 'planned'
  | 'active'
  | 'waiting_for_submission'
  | 'completed'
  | 'needs_revision'
  | 'skipped';

export type NextStepDecision =
  | 'advance'
  | 'explain_again'
  | 'remediate'
  | 'practice'
  | 'simplify'
  | 'complete_task'
  | 'request_user_decision';

export interface LearningStep {
  id: Id;
  goalId: Id | null;
  stageId: Id | null;
  taskId: Id | null;
  blockId: Id | null;
  title: string;
  objective: string;
  instruction: string;
  expectedOutput: string;
  successCriteria: string;
  status: LearningStepStatus;
  attempt: number;
  position: number;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningRuntimeState {
  id: 'default';
  activeGoalId: Id | null;
  activeStageId: Id | null;
  activeDailyTaskId: Id | null;
  activeStepId: Id | null;
  activeQuestionThreadId: Id | null;
  sessionStatus: 'idle' | 'active' | 'paused' | 'completed';
  updatedAt: string;
}

export interface QuestionThread {
  id: Id;
  goalId: Id | null;
  stageId: Id | null;
  taskId: Id | null;
  stepId: Id | null;
  status: 'open' | 'resolved';
  question: string;
  resolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface QuestionMessage {
  id: Id;
  threadId: Id;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface LearningSubmission {
  id: Id;
  stepId: Id | null;
  dailyGuideActionId: Id | null;
  sessionId: Id | null;
  content: string;
  evaluationStatus: 'waiting' | 'completed' | 'failed';
  createdAt: string;
}

export interface LearningEvaluation {
  id: Id;
  submissionId: Id;
  stepId: Id | null;
  result: 'passed' | 'partial' | 'failed' | 'unclear';
  mastery: number;
  evidence: string[];
  correctParts: string[];
  misconceptions: string[];
  missingRequirements: string[];
  feedback: string;
  recommendedAction: NextStepDecision;
  decision: 'advance' | 'stay' | 'remediate' | 'replan';
  aiReviewId: Id | null;
  createdAt: string;
}

export interface StoredNextStepDecision {
  id: Id;
  evaluationId: Id;
  stepId: Id | null;
  decision: NextStepDecision;
  reason: string;
  taskCompleted: boolean;
  nextStep: {
    title: string;
    objective: string;
    instruction: string;
    expectedOutput: string;
    successCriteria: string;
  } | null;
  remediation: {
    title: string;
    instruction: string;
    expectedOutput: string;
    successCriteria: string;
  } | null;
  carryForward: string | null;
  aiReviewId: Id | null;
  createdAt: string;
}

export interface LearningSummary {
  id: Id;
  kind: 'question' | 'step' | 'task' | 'day' | 'stage';
  refId: Id;
  status: 'pending' | 'ready' | 'failed';
  summary: unknown;
  createdAt: string;
}

export interface PlanAdjustmentProposal {
  id: Id;
  goalId: Id | null;
  stageId: Id | null;
  taskId: Id | null;
  sourceDecisionId: Id | null;
  status: 'pending' | 'accepted' | 'rejected';
  reason: string;
  proposedChanges: unknown;
  appliedTaskId: Id | null;
  createdAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
}

export interface LearningRuntimeSnapshot {
  state: LearningRuntimeState;
  goal: LearningGoal | null;
  dailyGuide: DailyGuide | null;
  dailyGuideTask: DailyGuideTask | null;
  dailyGuideAction: DailyGuideAction | null;
  roadmapStage: RoadmapStage | null;
  questionThread: QuestionThread | null;
  questionMessages: QuestionMessage[];
  latestSubmission: LearningSubmission | null;
  latestEvaluation: LearningEvaluation | null;
  latestDecision: StoredNextStepDecision | null;
  pendingAdjustment: PlanAdjustmentProposal | null;
}

export interface PromptProfile {
  id: Id;
  key: PromptProfileKey;
  name: string;
  description: string;
  activeVersionId: Id | null;
  version: number;
  content: string;
}

export interface ReviewResult {
  reviewId: Id;
  date: string;
  completionScore: number;
  focusScore: number;
  summary: string;
  nextActions: string[];
  planAdjustments: Array<{
    dayIndex: number;
    title: string;
    focus: string;
    expectedOutput: string;
    successCriteria: string;
    reason: string;
  }>;
}

export interface TeachStepResult {
  step: LearningStep;
  explanation: string;
  userAction: string;
  requiresSubmission: boolean;
  contextSourceIds: string[];
}

export interface QuestionAnswerResult {
  thread: QuestionThread;
  messages: QuestionMessage[];
  answer: string;
  resolved: boolean;
  returnToStepInstruction: string;
}

export interface SubmissionEvaluationResult {
  submission: LearningSubmission;
  evaluation: LearningEvaluation;
  decision: StoredNextStepDecision;
  nextAction: DailyGuideAction | null;
}

export interface StudyAppApi {
  settings: {
    get: () => Promise<AppSettings>;
    update: (patch: Partial<AppSettings> & { deepseekApiKey?: string }) => Promise<AppSettings>;
  };
  onboarding: {
    getCurrent: () => Promise<GoalIntakeState>;
    sendMessage: (content: string) => Promise<GoalIntakeState>;
    confirmGoal: (briefPatch?: Partial<GoalBrief>) => Promise<{ goal: LearningGoal; intake: GoalIntake }>;
  };
  guides: {
    generateLayeredPlan: (goalId: Id) => Promise<LayeredPlanResult>;
    confirmDailyGuide: (guideId: Id) => Promise<DailyGuide>;
    archiveTodayAndRestart: () => Promise<GoalIntakeState>;
    prepareCurrentLearningDay: (forceRetry?: boolean) => Promise<PrepareCurrentLearningDayResult>;
    startNextSession: (goalId?: Id) => Promise<StartNextSessionResult>;
    generateRollingPlan: (goalId: Id) => Promise<GenerateRollingPlanResult>;
    getTodayState: () => Promise<TodayState>;
    listToday: () => Promise<TodayGuideState>;
  };
  history: {
    listAll: () => Promise<HistoryIntakeSummary[]>;
    getById: (intakeId: Id) => Promise<GoalIntakeState>;
  };
  sessions: {
    getActive: () => Promise<{ session: StudySession; block: DailyPlanBlock } | null>;
    start: (taskId: Id) => Promise<StudySession>;
    pause: (sessionId: Id) => Promise<StudySession>;
    skip: (blockId: Id, reason: string) => Promise<void>;
    getAccumulated: (taskId: Id, excludeSessionId?: Id) => Promise<number>;
  };
  learning: {
    getState: () => Promise<LearningRuntimeSnapshot>;
    teachCurrentStep: (promptProfileId?: Id) => Promise<TeachStepResult>;
    completeCurrentAction: () => Promise<LearningRuntimeSnapshot>;
    skipCurrentAction: () => Promise<LearningRuntimeSnapshot>;
    skipCurrentTask: () => Promise<LearningRuntimeSnapshot>;
    terminateLearning: () => Promise<LearningRuntimeSnapshot>;
    askQuestion: (question: string, promptProfileId?: Id) => Promise<QuestionAnswerResult>;
    resolveQuestion: (threadId: Id, summary?: string) => Promise<LearningRuntimeSnapshot>;
    submitResult: (content: string, promptProfileId?: Id) => Promise<SubmissionEvaluationResult>;
    retrySubmissionEvaluation: (submissionId: Id, promptProfileId?: Id) => Promise<SubmissionEvaluationResult>;
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected') => Promise<PlanAdjustmentProposal>;
  };
  reviews: {
    generate: (date: string) => Promise<ReviewResult>;
    getLatest: (date?: string) => Promise<ReviewResult | null>;
    applyAdjustments: (goalId: string, adjustments: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
      reason: string;
    }>) => Promise<ShortPlanDay[]>;
  };
  knowledge: {
    listForGoal: (goalId: string) => Promise<KnowledgeItem[]>;
  };
  system: {
    auditRuntime: () => Promise<{ consistent: boolean; fixed: string[]; conflicts: Array<{ field: string; expected: string; actual: string }> }>;
  };
  data: {
    exportGoal: (goalId: string) => Promise<Record<string, unknown>>;
  };
  prompts: {
    list: () => Promise<PromptProfile[]>;
    update: (profileId: Id, content: string) => Promise<PromptProfile>;
  };
  onSessionStateChanged: (callback: (data: { session: StudySession | null; block: DailyPlanBlock | null }) => void) => () => void;
}
