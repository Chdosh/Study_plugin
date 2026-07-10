import { contextBridge, ipcRenderer } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type {
  AppSettings,
  DailyPlanBlock,
  GoalBrief,
  GenerateRollingPlanResult,
  HistoryIntakeSummary,
  Id,
  LearningRuntimeSnapshot,
  LearningGoal,
  GoalIntake,
  GoalIntakeState,
  LayeredPlanResult,
  PlanAdjustmentProposal,
  PrepareCurrentLearningDayResult,
  QuestionAnswerResult,
  StudyAppApi,
  StudySession,
  StartNextSessionResult,
  SubmissionEvaluationResult,
  TodayGuideState,
  TodayState,
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
    confirmGoal: (briefPatch?: Partial<GoalBrief>): Promise<{ goal: LearningGoal; intake: GoalIntake }> =>
      ipcRenderer.invoke(ipcChannels.onboardingConfirmGoal, { briefPatch })
  },
  guides: {
    generateLayeredPlan: (goalId: Id): Promise<LayeredPlanResult> =>
      ipcRenderer.invoke(ipcChannels.guidesGenerateLayeredPlan, { goalId }),
    confirmDailyGuide: (guideId: Id) => ipcRenderer.invoke(ipcChannels.guidesConfirmDailyGuide, { guideId }),
    archiveTodayAndRestart: (): Promise<GoalIntakeState> =>
      ipcRenderer.invoke(ipcChannels.guidesArchiveTodayAndRestart),
    prepareCurrentLearningDay: (forceRetry?: boolean): Promise<PrepareCurrentLearningDayResult> =>
      ipcRenderer.invoke(ipcChannels.guidesPrepareCurrentLearningDay, { forceRetry }),
    startNextSession: (goalId?: Id): Promise<StartNextSessionResult> =>
      ipcRenderer.invoke(ipcChannels.guidesStartNextSession, { goalId }),
    generateRollingPlan: (goalId: Id): Promise<GenerateRollingPlanResult> =>
      ipcRenderer.invoke(ipcChannels.guidesGenerateRollingPlan, { goalId }),
    getTodayState: (): Promise<TodayState> =>
      ipcRenderer.invoke(ipcChannels.guidesGetTodayState),
    listToday: (): Promise<TodayGuideState> => ipcRenderer.invoke(ipcChannels.guidesListToday)
  },
  history: {
    listAll: (): Promise<HistoryIntakeSummary[]> => ipcRenderer.invoke(ipcChannels.historyListAll),
    getById: (intakeId: Id): Promise<GoalIntakeState> => ipcRenderer.invoke(ipcChannels.historyGetById, { intakeId })
  },
  sessions: {
    getActive: () => ipcRenderer.invoke(ipcChannels.sessionGetActive),
    start: (taskId: Id) => ipcRenderer.invoke(ipcChannels.sessionsStart, { taskId }),
    pause: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsPause, { sessionId }),
    skip: (blockId: Id, reason: string) => ipcRenderer.invoke(ipcChannels.sessionsSkip, { blockId, reason }),
    getAccumulated: (taskId: Id, excludeSessionId?: Id) =>
      ipcRenderer.invoke(ipcChannels.sessionsGetAccumulated, { blockId: taskId, excludeSessionId })
  },
  learning: {
    getState: (): Promise<LearningRuntimeSnapshot> => ipcRenderer.invoke(ipcChannels.learningGetState),
    teachCurrentStep: (promptProfileId?: Id): Promise<TeachStepResult> =>
      ipcRenderer.invoke(ipcChannels.learningTeachCurrentStep, { promptProfileId }),
    completeCurrentAction: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCompleteCurrentAction),
    skipCurrentAction: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningSkipCurrentAction),
    skipCurrentTask: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningSkipCurrentTask),
    terminateLearning: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningTerminateLearning),
    askQuestion: (question: string, promptProfileId?: Id): Promise<QuestionAnswerResult> =>
      ipcRenderer.invoke(ipcChannels.learningAskQuestion, { question, promptProfileId }),
    resolveQuestion: (threadId: Id, summary?: string): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningResolveQuestion, { threadId, summary }),
    submitResult: (content: string, promptProfileId?: Id): Promise<SubmissionEvaluationResult> =>
      ipcRenderer.invoke(ipcChannels.learningSubmitResult, { content, promptProfileId }),
    retrySubmissionEvaluation: (submissionId: Id, promptProfileId?: Id): Promise<SubmissionEvaluationResult> =>
      ipcRenderer.invoke(ipcChannels.learningRetrySubmissionEvaluation, { submissionId, promptProfileId }),
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> =>
      ipcRenderer.invoke(ipcChannels.learningDecideAdjustment, { proposalId, status })
  },
  reviews: {
    generate: (date: string) => ipcRenderer.invoke(ipcChannels.reviewsGenerate, { date }),
    getLatest: (date?: string) => ipcRenderer.invoke(ipcChannels.reviewsGetLatest, { date }),
    applyAdjustments: (goalId: string, adjustments: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
      reason: string;
    }>) => ipcRenderer.invoke(ipcChannels.reviewsApplyAdjustments, { goalId, adjustments })
  },
  knowledge: {
    listForGoal: (goalId: string) => ipcRenderer.invoke(ipcChannels.knowledgeListForGoal, { goalId })
  },
  prompts: {
    list: () => ipcRenderer.invoke(ipcChannels.promptsList),
    update: (profileId: Id, content: string) =>
      ipcRenderer.invoke(ipcChannels.promptsUpdate, { profileId, content })
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
