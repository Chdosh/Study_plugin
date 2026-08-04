export type Id = string;

export type PromptProfileKey = 'foundation' | 'standard' | 'advanced' | 'exam' | 'recovery';

export type LearningStyle = 'concise' | 'detailed' | 'code_first';

export interface AiProviderStatus {
  state: 'unverified' | 'available' | 'failed';
  checkedAt: string | null;
  model: string | null;
  errorCategory: string | null;
  message: string | null;
}

export interface AppSettings {
  aiBaseUrl: string;
  aiModel: string;
  hasAiApiKey: boolean;
  aiProviderStatus?: AiProviderStatus;
  autoLaunch: boolean;
  defaultBlockMinutes: number;
  dailyStudyWindows: StudyWindow[];
  learningStyle?: LearningStyle;
}

export type UpdateAppSettingsInput =
  Partial<Omit<AppSettings, 'hasAiApiKey' | 'aiProviderStatus'>>
  & { aiApiKey?: string };

export function hasCompleteAiConfiguration(
  settings: Pick<AppSettings, 'aiBaseUrl' | 'aiModel' | 'hasAiApiKey'>
): boolean {
  return settings.hasAiApiKey
    && settings.aiBaseUrl.trim().length > 0
    && settings.aiModel.trim().length > 0;
}

export interface StudyWindow {
  start: string;
  end: string;
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
  depth: string;
  direction: string;
  constraints: string[];
  successCriteria: string[];
}

export interface GoalIntakeQuestion {
  prompt: string;
  options: string[];
}

export interface GoalIntake {
  id: Id;
  status: 'collecting' | 'ready' | 'confirmed';
  goalId: Id | null;
  brief: GoalBrief | null;
  questions: GoalIntakeQuestion[];
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

export interface PendingAgentInteraction {
  id: Id;
  runReviewId: Id;
  toolReviewId: Id;
  scopeType: string;
  scopeId: Id;
  question: string;
  reason: string;
  answerMode: 'free_text' | 'single_choice';
  options: string[];
  canSkip: boolean;
  intent: string;
  expectedContextVersion: number;
  status: 'open' | 'answered' | 'skipped' | 'cancelled';
  answerText: string | null;
  answerMessageRefId: Id | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface GoalIntakeState {
  intake: GoalIntake;
  messages: GoalIntakeMessage[];
  activeGoal: LearningGoal | null;
  pendingInteraction?: PendingAgentInteraction | null;
}

export type RoadmapStageStatus = 'pending' | 'active' | 'ready_for_review' | 'completed';

export interface RoadmapStage {
  id: Id;
  goalId: Id;
  title: string;
  objective: string;
  direction: string;
  successCriteria: string;
  targetDate: string | null;
  status: RoadmapStageStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type GoalProgressStatus =
  | 'schedule_unset'
  | 'on_schedule'
  | 'checkpoint_missed'
  | 'goal_due'
  | 'completed';

export interface GoalProgress {
  status: GoalProgressStatus;
  dueDate: string | null;
  currentStageTargetDate: string | null;
  currentStageTitle: string | null;
}

export type NearTermPlanItemStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface NearTermPlanItem {
  id: Id;
  goalId: Id;
  roadmapStageId: string | null;
  itemIndex: number;
  date: string | null;
  sessionStatus: NearTermPlanItemStatus;
  title: string;
  focus: string;
  tasks: string[];
  expectedOutput: string;
  successCriteria: string;
  createdAt: string;
}

export interface GenerateRollingPlanResult {
  goal: LearningGoal;
  roadmap: RoadmapStage[];
  shortPlan: NearTermPlanItem[];
  guide: DailyGuide;
  activatedStage: RoadmapStage | null;
}

export type KnowledgeItemSourceType = 'misconception' | 'weakness' | 'insight' | 'correction';
export type KnowledgeItemStatus = 'active' | 'resolved' | 'dormant';
export type QualitativeMasteryState =
  | 'needs_reinforcement'
  | 'initial_understanding'
  | 'can_apply'
  | 'stable';

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
  masteryState: QualitativeMasteryState;
  masteryLabel: '需要巩固' | '初步理解' | '能够应用' | '较稳定';
  masteryReason: string;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export type LearnerFactScope = 'task' | 'goal' | 'global';
export type LearnerFactSource = 'user_stated' | 'inferred' | 'confirmed';

export interface LearnerFact {
  id: Id;
  goalId: Id | null;
  taskId?: Id | null;
  scope: LearnerFactScope;
  key: string;
  value: string;
  source: LearnerFactSource;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimatedMinutes {
  min: number;
  target: number;
  max: number;
}

export type DailyGuideTaskStatus = 'planned' | 'active' | 'deferred' | 'closed';
export type DailyGuideActionStatus = 'planned' | 'done' | 'skipped';
export type TaskClosureKind = 'completed' | 'partial' | 'abandoned' | 'replaced';

export interface DailyGuideAction {
  id: Id;
  taskId: Id;
  title: string;
  instruction: string;
  checkpoint: string;
  requirement: 'required' | 'optional';
  status: DailyGuideActionStatus;
  progressNote: string | null;
  completedAt: string | null;
  origin: 'guide_generated' | 'agent_supplement';
  sourceAiReviewId: Id | null;
  position: number;
}

export interface DailyGuideTask {
  id: Id;
  guideId: Id | null;
  roadmapStageId: Id | null;
  title: string;
  objective: string;
  scope: string;
  estimatedMinutes: EstimatedMinutes;
  actions: DailyGuideAction[];
  deliverable: string;
  doneWhen: string[];
  quickHint: string;
  evaluationMode: 'local' | 'ai';
  status: DailyGuideTaskStatus;
  closureKind: TaskClosureKind | null;
  closureReason: string | null;
  nextStartPoint: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyGuide {
  id: Id;
  goalId: Id;
  nearTermPlanItemId: string | null;
  date: string;
  status: 'draft' | 'confirmed' | 'completed' | 'archived';
  sessionStatus: 'draft' | 'active' | 'closed' | 'archived';
  weekFocus: string;
  todayGoal: string;
  deliverables: string[];
  boundaries: string[];
  acceptanceCriteria: string[];
  tomorrowActions: string[];
  createdAt: string;
  confirmedAt: string | null;
  tasks: DailyGuideTask[];
}

export interface ResumableGuideSummary {
  guideId: Id;
  goalId: Id;
  goalTitle: string;
  taskTitle: string;
  completedTaskCount: number;
  totalTaskCount: number;
}

export interface LayeredPlanResult {
  goal: LearningGoal;
  roadmap: RoadmapStage[];
  shortPlan: NearTermPlanItem[];
  guide: DailyGuide;
}

export type LearningPreparationState =
  | 'needs_goal'
  | 'ready_to_generate'
  | 'generating'
  | 'generation_failed'
  | 'active'
  | 'stage_review_required'
  | 'completed'
  | 'plan_exhausted';

export interface LearningOverviewState {
  goal: LearningGoal | null;
  roadmap: RoadmapStage[];
  shortPlan: NearTermPlanItem[];
  guide: DailyGuide | null;
  currentStage: RoadmapStage | null;
  goalProgress: GoalProgress;
  preparationState: LearningPreparationState;
  errorMessage?: string;
  pendingEvaluations?: string[];
  planPhase?: string | null;
}

export interface PreviousLearningUnitResult {
  completedTasks: string[];
  evaluationSummary: string;
  reviewSummary?: string;
}

export interface PrepareCurrentLearningUnitResult {
  preparationState: LearningPreparationState;
  result?: LayeredPlanResult;
  errorMessage?: string;
}

export interface StudySession {
  id: Id;
  taskId: Id | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  status: 'active' | 'paused' | 'completed' | 'skipped';
  notes: string | null;
}



export type NextStepDecision =
  | 'advance'
  | 'explain_again'
  | 'remediate'
  | 'practice'
  | 'simplify'
  | 'complete_task'
  | 'request_user_decision';

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
  taskId: Id;
  stepId: Id | null;
  dailyGuideActionId: Id | null;
  sessionId: Id | null;
  content: string;
  evaluationStatus: 'waiting' | 'evaluating' | 'completed' | 'failed';
  applicationStatus: 'pending' | 'applied' | 'failed' | null;
  applicationError: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface LearningEvaluation {
  id: Id;
  submissionId: Id;
  stepId: Id | null;
  result: 'passed' | 'partial' | 'failed' | 'unclear';
  evidence: string[];
  correctParts: string[];
  misconceptions: string[];
  missingRequirements: string[];
  feedback: string;
  recommendedAction: NextStepDecision;
  decision: 'advance' | 'stay' | 'remediate' | 'replan';
  selfNote?: string | null;
  recommendationDecision?: 'pending' | 'accepted' | 'declined' | 'deferred' | null;
  recommendationDecisionReason?: string | null;
  applicationStatus?: 'pending' | 'applied' | 'failed' | null;
  applicationError?: string | null;
  appliedAt?: string | null;
  source: 'ai' | 'user_correction';
  supersedesEvaluationId: Id | null;
  correctionReason: string | null;
  aiReviewId: Id | null;
  createdAt: string;
}

/** Renderer DTO compatibility name; runtime code should use NearTermPlanItem. */

export interface TemporaryTaskConversionResult extends QuestionAnswerResult {
  taskId: Id;
  guideId: Id | null;
}

export interface SubmissionAttemptHistory {
  submission: LearningSubmission;
  evaluations: LearningEvaluation[];
  latestEvaluation: LearningEvaluation | null;
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
  submissionAttempts: SubmissionAttemptHistory[];
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
    itemIndex: number;
    title: string;
    focus: string;
    expectedOutput: string;
    successCriteria: string;
    reason: string;
  }>;
}

export interface TeachStepResult {
  runId: Id;
  action: DailyGuideAction;
  artifacts: LearningTurnArtifact[];
  contextSourceIds: string[];
  pendingInteraction?: PendingAgentInteraction;
}

export interface LearningTurnArtifact {
  kind: 'explanation' | 'quiz' | 'practice' | 'evaluation' | 'question';
  explanation: string;
  userAction: string;
  requiresSubmission: boolean;
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

export interface LearningSubmissionResult {
  submission: LearningSubmission;
  state: LearningRuntimeSnapshot;
}

export type LearningEvaluationNotification =
  | { status: 'completed'; result: SubmissionEvaluationResult; triggeredByUser?: boolean }
  | { status: 'failed'; submissionId: Id; message: string; triggeredByUser?: boolean };

export interface CurrentGuideChoice {
  guideId: Id;
  date: string;
  dayTitle: string;
  taskTitle: string;
  completedTaskCount: number;
  totalTaskCount: number;
  hasRecentSession: boolean;
  isRecommended: boolean;
  isCurrent: boolean;
}

export interface RuntimeAuditResult {
  consistent: boolean;
  fixed: string[];
  checkedAt: string;
  guideChoices: CurrentGuideChoice[];
}

export interface PlanVersionEntry {
  version: number;
  changeSummary: string;
  createdAt: string;
  snapshot: {
    shortPlan?: Array<{
      itemIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
    }>;
    reason?: string;
  } | null;
}

export interface PlanProposalInput {
  reason: string;
  adjustments: Array<{
    itemIndex: number;
    title: string;
    focus: string;
    expectedOutput: string;
    successCriteria: string;
  }>;
}

export interface StudyAppApi {
  settings: {
    get: () => Promise<AppSettings>;
    update: (patch: UpdateAppSettingsInput) => Promise<AppSettings>;
  };
  onboarding: {
    getCurrent: () => Promise<GoalIntakeState>;
    sendMessage: (content: string) => Promise<GoalIntakeState>;
    cancelQuestion: () => Promise<GoalIntakeState>;
    generateInitialPlan: (briefPatch?: Partial<GoalBrief>) => Promise<LearningOverviewState>;
  };
  guides: {
    confirmLearningGuide: (guideId: Id) => Promise<DailyGuide>;
    resetLearningWorkspace: () => Promise<GoalIntakeState>;
    prepareCurrentLearningUnit: (forceRetry?: boolean) => Promise<PrepareCurrentLearningUnitResult>;
    generateRollingPlan: (goalId: Id) => Promise<GenerateRollingPlanResult>;
    listResumable: () => Promise<ResumableGuideSummary[]>;
    restoreArchivedGuide: (guideId: Id) => Promise<LearningRuntimeSnapshot>;
    getOverview: () => Promise<LearningOverviewState>;
  };
  sessions: {
    getActive: () => Promise<StudySession | null>;
    start: (taskId: Id) => Promise<StudySession>;
    pause: (sessionId: Id) => Promise<StudySession>;
    end: (sessionId: Id) => Promise<StudySession>;
  };
  learning: {
    getState: () => Promise<LearningRuntimeSnapshot>;
    teachCurrentStep: (promptProfileId?: Id) => Promise<TeachStepResult>;
    resumeLearningTurn: (
      pendingInteractionId: Id,
      answer: string,
      expectedContextVersion: number
    ) => Promise<TeachStepResult>;
    cancelLearningTurn: (pendingInteractionId: Id) => Promise<boolean>;
    completeCurrentAction: (actionId: Id, note?: string) => Promise<LearningRuntimeSnapshot>;
    skipCurrentAction: (actionId: Id) => Promise<LearningRuntimeSnapshot>;
    askQuestion: (question: string, promptProfileId?: Id) => Promise<QuestionAnswerResult>;
    askTemporaryQuestion: (
      question: string,
      promptProfileId?: Id,
      threadId?: Id
    ) => Promise<QuestionAnswerResult>;
    getLatestTemporaryQuestion: () => Promise<QuestionAnswerResult | null>;
    linkTemporaryQuestionToGoal: (threadId: Id, goalId: Id) => Promise<QuestionAnswerResult>;
    keepTemporaryQuestion: (threadId: Id) => Promise<QuestionAnswerResult>;
    convertTemporaryQuestionToTask: (
      threadId: Id,
      goalId: Id
    ) => Promise<TemporaryTaskConversionResult>;
    resolveQuestion: (threadId: Id, summary?: string) => Promise<LearningRuntimeSnapshot>;
    submitResult: (content: string, promptProfileId?: Id) => Promise<LearningSubmissionResult>;
    retryEvaluation: (submissionId: Id) => Promise<LearningSubmission>;
    correctEvaluation: (evaluationId: Id, reason: string) => Promise<LearningRuntimeSnapshot>;
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected') => Promise<PlanAdjustmentProposal>;
    decideEvaluationRecommendation: (
      evaluationId: Id,
      decision: 'accepted' | 'declined' | 'deferred',
      reason?: string
    ) => Promise<LearningRuntimeSnapshot>;
  };
  reviews: {
    generate: (date: string) => Promise<ReviewResult>;
    getLatest: (date?: string) => Promise<ReviewResult | null>;
  };
  knowledge: {
    listForGoal: (goalId: string) => Promise<KnowledgeItem[]>;
    setStatus: (itemId: Id, status: KnowledgeItemStatus) => Promise<KnowledgeItem>;
  };
  learnerContext: {
    proposeFact: (goalId: string, fact: { scope: LearnerFactScope; taskId?: Id; key: string; value: string; source: LearnerFactSource; confidence?: number }) => Promise<LearnerFact>;
    listForGoal: (goalId: string, scope?: LearnerFactScope) => Promise<LearnerFact[]>;
    confirmFact: (goalId: string, key: string, scope: LearnerFactScope, taskId?: Id) => Promise<LearnerFact>;
    deleteFact: (goalId: string, key: string, scope: LearnerFactScope, taskId?: Id) => Promise<void>;
  };
  system: {
    auditRuntime: () => Promise<RuntimeAuditResult>;
    selectCurrentGuide: (guideId: Id) => Promise<RuntimeAuditResult>;
  };
  data: {
    listGoals: () => Promise<LearningGoal[]>;
    exportGoal: (goalId: string) => Promise<Record<string, unknown>>;
    getPlanVersions: (goalId: string) => Promise<PlanVersionEntry[]>;
    createPlanProposal: (goalId: string, proposal: PlanProposalInput) => Promise<PlanAdjustmentProposal>;
    confirmPlanProposal: (proposalId: string) => Promise<PlanAdjustmentProposal>;
    confirmRoadmapStage: (goalId: Id, stageId: Id) => Promise<RoadmapStage[]>;
  };
  stats: {
    getTokenCost: (opts?: { goalId?: string; operation?: string; fromDate?: string; toDate?: string }) => Promise<{
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCalls: number;
      byOperation: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
      byDate: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
    }>;
  };
  onSessionStateChanged: (callback: (session: StudySession | null) => void) => () => void;
  onEvaluationFinished: (callback: (notification: LearningEvaluationNotification) => void) => () => void;
}
