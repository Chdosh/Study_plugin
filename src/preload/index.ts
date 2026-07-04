import { contextBridge, ipcRenderer } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type {
  AppSettings,
  DailyPlanBlock,
  FloatWindowApi,
  GoalBrief,
  HistoryIntakeSummary,
  Id,
  LearningRuntimeSnapshot,
  LearningGoal,
  GoalIntake,
  GoalIntakeState,
  LayeredPlanResult,
  PlanStage,
  PlanAdjustmentProposal,
  QuestionAnswerResult,
  RawImport,
  StageOutlineResult,
  StudyAppApi,
  StudySession,
  StudyWindow,
  SubmissionEvaluationResult,
  TodayGuideState,
  TeachStepResult,
  TaskItem
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
    listToday: (): Promise<TodayGuideState> => ipcRenderer.invoke(ipcChannels.guidesListToday)
  },
  history: {
    listAll: (): Promise<HistoryIntakeSummary[]> => ipcRenderer.invoke(ipcChannels.historyListAll),
    getById: (intakeId: Id): Promise<GoalIntakeState> => ipcRenderer.invoke(ipcChannels.historyGetById, { intakeId })
  },
  imports: {
    create: (rawText: string, source: RawImport['source']) =>
      ipcRenderer.invoke(ipcChannels.importsCreate, { rawText, source }),
    parse: (importId: Id, promptProfileId?: Id) =>
      ipcRenderer.invoke(ipcChannels.importsParse, { importId, promptProfileId })
  },
  tasks: {
    list: () => ipcRenderer.invoke(ipcChannels.tasksList),
    update: (taskId: Id, patch: Partial<TaskItem>) =>
      ipcRenderer.invoke(ipcChannels.tasksUpdate, { taskId, patch })
  },
  goals: {
    create: (title: string, description?: string): Promise<LearningGoal> =>
      ipcRenderer.invoke(ipcChannels.goalsCreate, { title, description }),
    list: (): Promise<LearningGoal[]> => ipcRenderer.invoke(ipcChannels.goalsList),
    listStages: (goalId?: Id): Promise<PlanStage[]> =>
      ipcRenderer.invoke(ipcChannels.goalsListStages, { goalId }),
    generateStages: (goalId?: Id, promptProfileId?: Id): Promise<StageOutlineResult> =>
      ipcRenderer.invoke(ipcChannels.goalsGenerateStages, { goalId, promptProfileId }),
    confirmStages: (goalId: Id): Promise<PlanStage[]> =>
      ipcRenderer.invoke(ipcChannels.goalsConfirmStages, { goalId })
  },
  plans: {
    list: (date?: string) => ipcRenderer.invoke(ipcChannels.plansList, { date }),
    generate: (date: string, availableWindows: StudyWindow[], promptProfileId?: Id) =>
      ipcRenderer.invoke(ipcChannels.plansGenerate, { date, availableWindows, promptProfileId }),
    confirm: (planId: Id) => ipcRenderer.invoke(ipcChannels.plansConfirm, { planId })
  },
  sessions: {
    getActive: () => ipcRenderer.invoke(ipcChannels.sessionGetActive),
    start: (blockId: Id) => ipcRenderer.invoke(ipcChannels.sessionsStart, { blockId }),
    pause: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsPause, { sessionId }),
    complete: (sessionId: Id, notes?: string) =>
      ipcRenderer.invoke(ipcChannels.sessionsComplete, { sessionId, notes }),
    skip: (blockId: Id, reason: string) => ipcRenderer.invoke(ipcChannels.sessionsSkip, { blockId, reason }),
    getAccumulated: (blockId: Id, excludeSessionId?: Id) =>
      ipcRenderer.invoke(ipcChannels.sessionsGetAccumulated, { blockId, excludeSessionId })
  },
  learning: {
    getState: (): Promise<LearningRuntimeSnapshot> => ipcRenderer.invoke(ipcChannels.learningGetState),
    teachCurrentStep: (promptProfileId?: Id): Promise<TeachStepResult> =>
      ipcRenderer.invoke(ipcChannels.learningTeachCurrentStep, { promptProfileId }),
    completeCurrentAction: (): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningCompleteCurrentAction),
    askQuestion: (question: string, promptProfileId?: Id): Promise<QuestionAnswerResult> =>
      ipcRenderer.invoke(ipcChannels.learningAskQuestion, { question, promptProfileId }),
    resolveQuestion: (threadId: Id, summary?: string): Promise<LearningRuntimeSnapshot> =>
      ipcRenderer.invoke(ipcChannels.learningResolveQuestion, { threadId, summary }),
    submitResult: (content: string, promptProfileId?: Id): Promise<SubmissionEvaluationResult> =>
      ipcRenderer.invoke(ipcChannels.learningSubmitResult, { content, promptProfileId }),
    decideAdjustment: (proposalId: Id, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> =>
      ipcRenderer.invoke(ipcChannels.learningDecideAdjustment, { proposalId, status })
  },
  reviews: {
    generate: (date: string) => ipcRenderer.invoke(ipcChannels.reviewsGenerate, { date })
  },
  prompts: {
    list: () => ipcRenderer.invoke(ipcChannels.promptsList),
    update: (profileId: Id, content: string) =>
      ipcRenderer.invoke(ipcChannels.promptsUpdate, { profileId, content })
  },
  onNavigate: (callback: (page: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, page: string) => {
      callback(page);
    };
    ipcRenderer.on(ipcChannels.navigateToPage, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.navigateToPage, handler);
    };
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

const floatApi: FloatWindowApi = {
  session: {
    getActive: () => ipcRenderer.invoke(ipcChannels.sessionGetActive),
    pause: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsPause, { sessionId }),
    resume: (blockId: Id) => ipcRenderer.invoke(ipcChannels.sessionsStart, { blockId }),
    complete: (sessionId: Id, notes?: string) =>
      ipcRenderer.invoke(ipcChannels.sessionsComplete, { sessionId, notes }),
    getAccumulated: (blockId: Id, excludeSessionId?: Id) =>
      ipcRenderer.invoke(ipcChannels.sessionsGetAccumulated, { blockId, excludeSessionId }),
    onStateChanged: (callback: (data: { session: StudySession; block: DailyPlanBlock | null }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { session: StudySession; block: DailyPlanBlock | null }) => {
        callback(data);
      };
      ipcRenderer.on(ipcChannels.sessionStateChanged, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.sessionStateChanged, handler);
      };
    }
  },
  float: {
    getPosition: () => ipcRenderer.invoke(ipcChannels.floatGetPosition),
    savePosition: (x: number, y: number) => ipcRenderer.invoke(ipcChannels.floatSavePosition, { x, y }),
    openMain: () => ipcRenderer.invoke(ipcChannels.floatOpenMain),
    resize: (width: number, height: number) => ipcRenderer.invoke(ipcChannels.floatResize, { width, height }),
    move: (deltaX: number, deltaY: number) => ipcRenderer.invoke(ipcChannels.floatMove, { deltaX, deltaY })
  }
};

contextBridge.exposeInMainWorld('studyApp', api);
contextBridge.exposeInMainWorld('floatApp', floatApi);
