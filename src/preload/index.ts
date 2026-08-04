import { contextBridge, ipcRenderer } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type {
  AppSettings,
  GoalBrief,
  GenerateRollingPlanResult,
  Id,
  KnowledgeItemStatus,
  LearnerFact,
  LearnerFactScope,
  LearnerFactSource,
  LearningRuntimeSnapshot,
  LearningSubmission,
  LearningSubmissionResult,
  LearningEvaluationNotification,
  GoalIntakeState,
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  PrepareCurrentLearningUnitResult,
  QuestionAnswerResult,
  StudyAppApi,
  StudySession,
  LearningOverviewState,
  TeachStepResult,
  UpdateAppSettingsInput
} from '../shared/types';

const api: StudyAppApi = {
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (patch: UpdateAppSettingsInput) =>
      ipcRenderer.invoke(ipcChannels.settingsUpdate, patch)
  },
  onboarding: {
    getCurrent: (): Promise<GoalIntakeState> => ipcRenderer.invoke(ipcChannels.onboardingGetCurrent),
    sendMessage: (content: string): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.onboardingSendMessage, { content }),
    cancelQuestion: (): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.onboardingCancelQuestion),
    generateInitialPlan: (briefPatch?: Partial<GoalBrief>): Promise<LearningOverviewState> =>
      ipcRenderer.invoke(ipcChannels.onboardingGenerateInitialPlan, { briefPatch })
  },
  guides: {
    confirmLearningGuide: (guideId: Id) => ipcRenderer.invoke(ipcChannels.guidesConfirmLearningGuide, { guideId }),
    resetLearningWorkspace: (): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.guidesResetLearningWorkspace),
    prepareCurrentLearningUnit: (forceRetry?: boolean): Promise<PrepareCurrentLearningUnitResult> =>
      ipcRenderer.invoke(ipcChannels.guidesPrepareCurrentLearningUnit, { forceRetry }),
    generateRollingPlan: (goalId: Id): Promise<GenerateRollingPlanResult> =>
      ipcRenderer.invoke(ipcChannels.guidesGenerateRollingPlan, { goalId }),
    listResumable: () => ipcRenderer.invoke(ipcChannels.guidesListResumable),
    restoreArchivedGuide: (guideId: Id): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.guidesRestoreArchived, { guideId }),
    getOverview: (): Promise<LearningOverviewState> => ipcRenderer.invoke(ipcChannels.guidesGetOverview)
  },
  sessions: {
    getActive: () => ipcRenderer.invoke(ipcChannels.sessionGetActive),
    start: (taskId: Id) => ipcRenderer.invoke(ipcChannels.sessionsStart, { taskId }),
    pause: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsPause, { sessionId }),
    end: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsEnd, { sessionId })
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
    completeCurrentAction: (actionId: Id, note?: string): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCompleteCurrentAction, { actionId, note }),
    skipCurrentAction: (actionId: Id): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningSkipCurrentAction, { actionId }),
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
    submitResult: (content: string, promptProfileId?: Id): Promise<LearningSubmissionResult> =>
      ipcRenderer.invoke(ipcChannels.learningSubmitResult, { content, promptProfileId }),
    retryEvaluation: (submissionId: Id): Promise<LearningSubmission> =>
      ipcRenderer.invoke(ipcChannels.learningRetryEvaluation, { submissionId }),
    correctEvaluation: (evaluationId: Id, reason: string): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCorrectEvaluation, { evaluationId, reason }),
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> =>
      ipcRenderer.invoke(ipcChannels.learningDecideAdjustment, { proposalId, status }),
    decideEvaluationRecommendation: (
      evaluationId: Id,
      decision: 'accepted' | 'declined' | 'deferred',
      reason?: string
    ): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningDecideEvaluationRecommendation, {
        evaluationId,
        decision,
        reason
      })
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
  system: {
    auditRuntime: () => ipcRenderer.invoke(ipcChannels.systemAuditRuntime),
    selectCurrentGuide: (guideId: Id) => ipcRenderer.invoke(ipcChannels.systemSelectCurrentGuide, { guideId })
  },
  data: {
    listGoals: () => ipcRenderer.invoke(ipcChannels.dataListGoals),
    exportGoal: (goalId: string) => ipcRenderer.invoke(ipcChannels.dataExportGoal, { goalId }),
    getPlanVersions: (goalId: string) => ipcRenderer.invoke(ipcChannels.dataGetPlanVersions, { goalId }),
    createPlanProposal: (goalId: string, proposal: PlanProposalInput) => ipcRenderer.invoke(ipcChannels.dataCreatePlanProposal, { goalId, proposal }),
    confirmPlanProposal: (proposalId: string) => ipcRenderer.invoke(ipcChannels.dataConfirmPlanProposal, { proposalId }),
    confirmRoadmapStage: (goalId: string, stageId: string) => ipcRenderer.invoke(ipcChannels.dataConfirmRoadmapStage, { goalId, stageId })
  },
  stats: {
    getTokenCost: (opts?: { goalId?: string; operation?: string; fromDate?: string; toDate?: string }) =>
      ipcRenderer.invoke(ipcChannels.statsGetTokenCost, opts ?? {})
  },
  onSessionStateChanged: (callback: (session: StudySession | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, session: StudySession | null) => {
      callback(session);
    };
    ipcRenderer.on(ipcChannels.sessionStateChanged, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.sessionStateChanged, handler);
    };
  },
  onEvaluationFinished: (callback: (notification: LearningEvaluationNotification) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, notification: LearningEvaluationNotification) => {
      callback(notification);
    };
    ipcRenderer.on(ipcChannels.learningEvaluationFinished, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.learningEvaluationFinished, handler);
    };
  }
};

contextBridge.exposeInMainWorld('studyApp', api);
