import { contextBridge, ipcRenderer } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type {
  AppSettings,
  DailyPlanBlock,
  GoalBrief,
  GenerateRollingPlanResult,
  HistoryIntakeSummary,
  Id,
  KnowledgeItemStatus,
  LearnerFact,
  LearnerFactScope,
  LearnerFactSource,
  LearningRuntimeSnapshot,
  LearningGoal,
  GoalIntake,
  GoalIntakeState,
  LayeredPlanResult,
  CloseTaskInput,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PrepareCurrentLearningUnitResult,
  QuestionAnswerResult,
  StudyAppApi,
  StudySession,
  StartNextSessionResult,
  SubmissionEvaluationResult,
  LearningOverviewState,
  LearningPreparationState,
  TeachStepResult
} from '../shared/types';

const api: StudyAppApi = {
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (patch: Partial<AppSettings> & { deepseekApiKey?: string }) =>
      ipcRenderer.invoke(ipcChannels.settingsUpdate, patch)
  },
  onboarding: {
    getCurrent: (): Promise<GoalIntakeState> => ipcRenderer.invoke(ipcChannels.onboardingGetCurrent),
    sendMessage: (content: string): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.onboardingSendMessage, { content }),
    cancelQuestion: (): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.onboardingCancelQuestion),
    confirmGoal: (briefPatch?: Partial<GoalBrief>): Promise<{ goal: LearningGoal; intake: GoalIntake }> =>
      ipcRenderer.invoke(ipcChannels.onboardingConfirmGoal, { briefPatch })
  },
  guides: {
    generateLayeredPlan: (goalId: Id): Promise<LayeredPlanResult> =>
      ipcRenderer.invoke(ipcChannels.guidesGenerateLayeredPlan, { goalId }),
    confirmLearningGuide: (guideId: Id) => ipcRenderer.invoke(ipcChannels.guidesConfirmLearningGuide, { guideId }),
    resetLearningWorkspace: (): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.guidesResetLearningWorkspace),
    prepareCurrentLearningUnit: (forceRetry?: boolean): Promise<PrepareCurrentLearningUnitResult> =>
      ipcRenderer.invoke(ipcChannels.guidesPrepareCurrentLearningUnit, { forceRetry }),
    startNextSession: (goalId?: Id): Promise<StartNextSessionResult> =>
      ipcRenderer.invoke(ipcChannels.guidesStartNextSession, { goalId }),
    generateRollingPlan: (goalId: Id): Promise<GenerateRollingPlanResult> =>
      ipcRenderer.invoke(ipcChannels.guidesGenerateRollingPlan, { goalId }),
    getPreparationState: (): Promise<LearningPreparationState> =>
      ipcRenderer.invoke(ipcChannels.guidesGetPreparationState),
    getOverview: (): Promise<LearningOverviewState> => ipcRenderer.invoke(ipcChannels.guidesGetOverview)
  },
  history: {
    listAll: (): Promise<HistoryIntakeSummary[]> => ipcRenderer.invoke(ipcChannels.historyListAll),
    getById: (intakeId: Id): Promise<GoalIntakeState> => ipcRenderer.invoke(ipcChannels.historyGetById, { intakeId })
  },
  sessions: {
    getActive: () => ipcRenderer.invoke(ipcChannels.sessionGetActive),
    start: (taskId: Id) => ipcRenderer.invoke(ipcChannels.sessionsStart, { taskId }),
    pause: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsPause, { sessionId }),
    end: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsEnd, { sessionId }),
    getAccumulated: (taskId: Id, excludeSessionId?: Id) =>
      ipcRenderer.invoke(ipcChannels.sessionsGetAccumulated, { blockId: taskId, excludeSessionId })
  },
  learning: {
    getState: (): Promise<LearningRuntimeSnapshot> => ipcRenderer.invoke(ipcChannels.learningGetState),
    teachCurrentStep: (promptProfileId?: Id): Promise<TeachStepResult> =>
      ipcRenderer.invoke(ipcChannels.learningTeachCurrentStep, { promptProfileId }),
    resumeLearningTurn: (
      pendingInteractionId: Id,
      answer: string,
      expectedContextVersion: number
    ): Promise<TeachStepResult> =>
      ipcRenderer.invoke(ipcChannels.learningResumeTurn, {
        pendingInteractionId,
        answer,
        expectedContextVersion
      }),
    cancelLearningTurn: (pendingInteractionId: Id): Promise<boolean> =>
      ipcRenderer.invoke(ipcChannels.learningCancelTurn, { pendingInteractionId }),
    completeCurrentAction: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCompleteCurrentAction),
    skipCurrentAction: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningSkipCurrentAction),
    closeCurrentTask: (input: CloseTaskInput): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCloseCurrentTask, input),
    terminateLearning: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningTerminateLearning),
    askQuestion: (question: string, promptProfileId?: Id): Promise<QuestionAnswerResult> =>
      ipcRenderer.invoke(ipcChannels.learningAskQuestion, { question, promptProfileId }),
    askTemporaryQuestion: (question: string, promptProfileId?: Id, threadId?: Id): Promise<QuestionAnswerResult> =>
      ipcRenderer.invoke(ipcChannels.learningAskTemporaryQuestion, { question, promptProfileId, threadId }),
    getLatestTemporaryQuestion: (): Promise<QuestionAnswerResult | null> =>
      ipcRenderer.invoke(ipcChannels.learningGetLatestTemporaryQuestion),
    linkTemporaryQuestionToGoal: (threadId: Id, goalId: Id): Promise<QuestionAnswerResult> =>
      ipcRenderer.invoke(ipcChannels.learningLinkTemporaryQuestionToGoal, { threadId, goalId }),
    keepTemporaryQuestion: (threadId: Id) =>
      ipcRenderer.invoke(ipcChannels.learningKeepTemporaryQuestion, { threadId }),
    convertTemporaryQuestionToTask: (threadId: Id, goalId: Id) =>
      ipcRenderer.invoke(ipcChannels.learningConvertTemporaryQuestionToTask, { threadId, goalId }),
    resolveQuestion: (threadId: Id, summary?: string): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningResolveQuestion, { threadId, summary }),
    submitResult: (content: string, promptProfileId?: Id): Promise<SubmissionEvaluationResult> =>
      ipcRenderer.invoke(ipcChannels.learningSubmitResult, { content, promptProfileId }),
    retrySubmissionEvaluation: (submissionId: Id, promptProfileId?: Id): Promise<SubmissionEvaluationResult> =>
      ipcRenderer.invoke(ipcChannels.learningRetrySubmissionEvaluation, { submissionId, promptProfileId }),
    decideRecommendation: (
      evaluationId: Id,
      decision: 'accepted' | 'declined' | 'deferred',
      reason?: string
    ): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningDecideRecommendation, { evaluationId, decision, reason }),
    correctEvaluation: (evaluationId: Id, reason: string): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCorrectEvaluation, { evaluationId, reason }),
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> =>
      ipcRenderer.invoke(ipcChannels.learningDecideAdjustment, { proposalId, status })
  },
  reviews: {
    generate: (date: string) => ipcRenderer.invoke(ipcChannels.reviewsGenerate, { date }),
    getLatest: (date?: string) => ipcRenderer.invoke(ipcChannels.reviewsGetLatest, { date }),
  },
  knowledge: {
    listForGoal: (goalId: string) => ipcRenderer.invoke(ipcChannels.knowledgeListForGoal, { goalId }),
    setStatus: (itemId: string, status: KnowledgeItemStatus) =>
      ipcRenderer.invoke(ipcChannels.knowledgeSetStatus, { itemId, status })
  },
  learnerContext: {
    proposeFact: (goalId: string, fact: { scope: LearnerFactScope; taskId?: string; key: string; value: string; source: LearnerFactSource; confidence?: number }) =>
      ipcRenderer.invoke(ipcChannels.learnerContextProposeFact, { goalId, fact }),
    listForGoal: (goalId: string, scope?: LearnerFactScope) =>
      ipcRenderer.invoke(ipcChannels.learnerContextListForGoal, { goalId, scope }),
    confirmFact: (goalId: string, key: string, scope: LearnerFactScope, taskId?: string) =>
      ipcRenderer.invoke(ipcChannels.learnerContextConfirmFact, { goalId, key, scope, taskId }),
    deleteFact: (goalId: string, key: string, scope: LearnerFactScope, taskId?: string) =>
      ipcRenderer.invoke(ipcChannels.learnerContextDeleteFact, { goalId, key, scope, taskId })
  },
  branch: {
    open: (kind: 'question' | 'debug' | 'practice', anchor: { goalId: string; taskId: string; actionId: string | null }, initialContent?: string) =>
      ipcRenderer.invoke(ipcChannels.branchOpen, { kind, anchor, initialContent }),
    append: (threadId: string, role: 'user' | 'assistant', content: string) =>
      ipcRenderer.invoke(ipcChannels.branchAppend, { threadId, role, content }),
    close: (threadId: string, strategy: string, options?: { summary?: string; factProposal?: any; promoteTaskId?: string }) =>
      ipcRenderer.invoke(ipcChannels.branchClose, { threadId, strategy, options }),
    promote: (threadId: string, taskId: string, summary?: string) =>
      ipcRenderer.invoke(ipcChannels.branchPromote, { threadId, taskId, summary }),
    getThread: (threadId: string) =>
      ipcRenderer.invoke(ipcChannels.branchGetThread, { threadId }),
    getMessages: (threadId: string) =>
      ipcRenderer.invoke(ipcChannels.branchGetMessages, { threadId })
  },
  system: {
    auditRuntime: () => ipcRenderer.invoke(ipcChannels.systemAuditRuntime),
    selectCurrentGuide: (guideId: Id) => ipcRenderer.invoke(ipcChannels.systemSelectCurrentGuide, { guideId }),
    resolveLearningUnit: (guideId: Id, decision: 'restore' | 'skip') =>
      ipcRenderer.invoke(ipcChannels.systemResolveLearningUnit, { guideId, decision })
  },
  data: {
    listGoals: () => ipcRenderer.invoke(ipcChannels.dataListGoals),
    exportGoal: (goalId: string) => ipcRenderer.invoke(ipcChannels.dataExportGoal, { goalId }),
    getPlanVersions: (goalId: string) => ipcRenderer.invoke(ipcChannels.dataGetPlanVersions, { goalId }),
    createPlanProposal: (goalId: string, proposal: PlanProposalInput) => ipcRenderer.invoke(ipcChannels.dataCreatePlanProposal, { goalId, proposal }),
    confirmPlanProposal: (proposalId: string) => ipcRenderer.invoke(ipcChannels.dataConfirmPlanProposal, { proposalId }),
    rejectPlanProposal: (proposalId: string) => ipcRenderer.invoke(ipcChannels.dataRejectPlanProposal, { proposalId }),
    confirmRoadmapStage: (goalId: string, stageId: string) => ipcRenderer.invoke(ipcChannels.dataConfirmRoadmapStage, { goalId, stageId })
  },
  prompts: {
    list: () => ipcRenderer.invoke(ipcChannels.promptsList),
    update: (profileId: Id, content: string) =>
      ipcRenderer.invoke(ipcChannels.promptsUpdate, { profileId, content })
  },
  stats: {
    getTokenCost: (opts?: { goalId?: string; operation?: string; fromDate?: string; toDate?: string }) =>
      ipcRenderer.invoke(ipcChannels.statsGetTokenCost, opts ?? {})
  },
  onSessionStateChanged: (callback: (data: { session: StudySession | null; block: DailyPlanBlock | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { session: StudySession | null; block: DailyPlanBlock | null }) => {
      callback(data);
    };
    ipcRenderer.on(ipcChannels.sessionStateChanged, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.sessionStateChanged, handler);
    };
  }
};

contextBridge.exposeInMainWorld('studyApp', api);
