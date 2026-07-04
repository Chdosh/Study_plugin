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

export interface RawImport {
  id: Id;
  source: 'chatgpt' | 'codex' | 'manual';
  rawText: string;
  status: 'created' | 'parsed' | 'failed';
  createdAt: string;
  parsedAt: string | null;
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

export interface RoadmapStage {
  id: Id;
  goalId: Id;
  title: string;
  objective: string;
  direction: string;
  successCriteria: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShortPlanDay {
  id: Id;
  goalId: Id;
  dayIndex: number;
  date: string | null;
  title: string;
  focus: string;
  tasks: string[];
  expectedOutput: string;
  successCriteria: string;
  createdAt: string;
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
  date: string;
  status: 'draft' | 'confirmed' | 'archived';
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

export interface TodayGuideState {
  goal: LearningGoal | null;
  roadmap: RoadmapStage[];
  shortPlan: ShortPlanDay[];
  guide: DailyGuide | null;
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

export interface DailyPlan {
  id: Id;
  date: string;
  status: 'draft' | 'confirmed' | 'archived';
  availableWindowsJson: string;
  createdAt: string;
  confirmedAt: string | null;
  version: number;
  blocks: DailyPlanBlock[];
}

export interface StudySession {
  id: Id;
  blockId: Id | null;
  taskId: Id | null;
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
  stepId: Id;
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
  stepId: Id;
  sessionId: Id | null;
  content: string;
  createdAt: string;
}

export interface LearningEvaluation {
  id: Id;
  submissionId: Id;
  stepId: Id;
  result: 'passed' | 'partial' | 'failed' | 'unclear';
  mastery: number;
  evidence: string[];
  correctParts: string[];
  misconceptions: string[];
  missingRequirements: string[];
  feedback: string;
  recommendedAction: NextStepDecision;
  aiReviewId: Id | null;
  createdAt: string;
}

export interface StoredNextStepDecision {
  id: Id;
  evaluationId: Id;
  stepId: Id;
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
  stage: PlanStage | null;
  task: TaskItem | null;
  block: DailyPlanBlock | null;
  step: LearningStep | null;
  questionThread: QuestionThread | null;
  questionMessages: QuestionMessage[];
  recentStepSummaries: LearningSummary[];
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

export interface ImportParseResult {
  importId: Id;
  goalsCreated: number;
  tasksCreated: number;
  tasks: TaskItem[];
}

export interface ReviewResult {
  reviewId: Id;
  date: string;
  completionScore: number;
  focusScore: number;
  summary: string;
  nextActions: string[];
}

export interface StageOutlineResult {
  goal: LearningGoal;
  stages: PlanStage[];
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
  nextStep: LearningStep | null;
}

export interface FloatWindowApi {
  session: {
    getActive: () => Promise<{ session: StudySession; block: DailyPlanBlock } | null>;
    pause: (sessionId: Id) => Promise<StudySession>;
    resume: (blockId: Id) => Promise<StudySession>;
    complete: (sessionId: Id, notes?: string) => Promise<StudySession>;
    getAccumulated: (blockId: Id, excludeSessionId?: Id) => Promise<number>;
    onStateChanged: (callback: (data: { session: StudySession; block: DailyPlanBlock | null }) => void) => () => void;
  };
  float: {
    getPosition: () => Promise<{ x: number; y: number } | null>;
    savePosition: (x: number, y: number) => Promise<void>;
    openMain: () => Promise<void>;
    resize: (width: number, height: number) => Promise<void>;
    move: (deltaX: number, deltaY: number) => Promise<void>;
  };
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
    listToday: () => Promise<TodayGuideState>;
  };
  history: {
    listAll: () => Promise<HistoryIntakeSummary[]>;
    getById: (intakeId: Id) => Promise<GoalIntakeState>;
  };
  imports: {
    create: (rawText: string, source: RawImport['source']) => Promise<RawImport>;
    parse: (importId: Id, promptProfileId?: Id) => Promise<ImportParseResult>;
  };
  tasks: {
    list: () => Promise<TaskItem[]>;
    update: (taskId: Id, patch: Partial<TaskItem>) => Promise<TaskItem>;
  };
  goals: {
    create: (title: string, description?: string) => Promise<LearningGoal>;
    list: () => Promise<LearningGoal[]>;
    listStages: (goalId?: Id) => Promise<PlanStage[]>;
    generateStages: (goalId?: Id, promptProfileId?: Id) => Promise<StageOutlineResult>;
    confirmStages: (goalId: Id) => Promise<PlanStage[]>;
  };
  plans: {
    list: (date?: string) => Promise<DailyPlan[]>;
    generate: (date: string, availableWindows: StudyWindow[], promptProfileId?: Id) => Promise<DailyPlan>;
    confirm: (planId: Id) => Promise<DailyPlan>;
  };
  sessions: {
    getActive: () => Promise<{ session: StudySession; block: DailyPlanBlock } | null>;
    start: (blockId: Id) => Promise<StudySession>;
    pause: (sessionId: Id) => Promise<StudySession>;
    complete: (sessionId: Id, notes?: string) => Promise<StudySession>;
    skip: (blockId: Id, reason: string) => Promise<void>;
    getAccumulated: (blockId: Id, excludeSessionId?: Id) => Promise<number>;
  };
  learning: {
    getState: () => Promise<LearningRuntimeSnapshot>;
    teachCurrentStep: (promptProfileId?: Id) => Promise<TeachStepResult>;
    completeCurrentAction: () => Promise<LearningRuntimeSnapshot>;
    askQuestion: (question: string, promptProfileId?: Id) => Promise<QuestionAnswerResult>;
    resolveQuestion: (threadId: Id, summary?: string) => Promise<LearningRuntimeSnapshot>;
    submitResult: (content: string, promptProfileId?: Id) => Promise<SubmissionEvaluationResult>;
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected') => Promise<PlanAdjustmentProposal>;
  };
  reviews: {
    generate: (date: string) => Promise<ReviewResult>;
  };
  prompts: {
    list: () => Promise<PromptProfile[]>;
    update: (profileId: Id, content: string) => Promise<PromptProfile>;
  };
  onNavigate: (callback: (page: string) => void) => () => void;
  onSessionStateChanged: (callback: (data: { session: StudySession | null; block: DailyPlanBlock | null }) => void) => () => void;
}
