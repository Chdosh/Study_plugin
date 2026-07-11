import { ipcMain } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type { AppService } from './services/app-service';

export function registerIpcHandlers(appService: AppService): void {
  ipcMain.handle(ipcChannels.settingsGet, () => appService.getSettings());
  ipcMain.handle(ipcChannels.settingsUpdate, (_event, patch) => appService.updateSettings(patch));
  ipcMain.handle(ipcChannels.onboardingGetCurrent, () => appService.getCurrentOnboarding());
  ipcMain.handle(ipcChannels.onboardingSendMessage, (_event, payload) =>
    appService.sendOnboardingMessage(payload.content)
  );
  ipcMain.handle(ipcChannels.onboardingConfirmGoal, (_event, payload) =>
    appService.confirmOnboardingGoal(payload?.briefPatch)
  );
  ipcMain.handle(ipcChannels.guidesGenerateLayeredPlan, (_event, payload) =>
    appService.generateLayeredPlan(payload.goalId)
  );
  ipcMain.handle(ipcChannels.guidesConfirmDailyGuide, (_event, payload) =>
    appService.confirmDailyGuide(payload.guideId)
  );
  ipcMain.handle(ipcChannels.guidesArchiveTodayAndRestart, () => appService.archiveTodayAndRestart());
  ipcMain.handle(ipcChannels.guidesPrepareCurrentLearningDay, (_event, payload) =>
    appService.prepareCurrentLearningDay(payload?.forceRetry)
  );
  ipcMain.handle(ipcChannels.guidesStartNextSession, (_event, payload) => appService.startNextSession(payload?.goalId));
  ipcMain.handle(ipcChannels.guidesGenerateRollingPlan, (_event, payload) =>
    appService.generateRollingPlan(payload.goalId)
  );
  ipcMain.handle(ipcChannels.guidesGetTodayState, () => appService.getTodayState());
  ipcMain.handle(ipcChannels.guidesListToday, () => appService.listTodayGuide());
  ipcMain.handle(ipcChannels.sessionsStart, (_event, payload) => appService.startSession(payload.taskId));
  ipcMain.handle(ipcChannels.sessionsPause, (_event, payload) => appService.pauseSession(payload.sessionId));
  ipcMain.handle(ipcChannels.sessionsSkip, (_event, payload) =>
    appService.skipBlock(payload.blockId, payload.reason)
  );
  ipcMain.handle(ipcChannels.sessionsGetAccumulated, (_event, payload) =>
    appService.getAccumulatedSeconds(payload.blockId, payload.excludeSessionId)
  );
  ipcMain.handle(ipcChannels.learningGetState, () => appService.getLearningState());
  ipcMain.handle(ipcChannels.learningTeachCurrentStep, (_event, payload) =>
    appService.teachCurrentStep(payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningCompleteCurrentAction, () => appService.completeCurrentAction());
  ipcMain.handle(ipcChannels.learningSkipCurrentAction, () => appService.skipCurrentAction());
  ipcMain.handle(ipcChannels.learningSkipCurrentTask, () => appService.skipCurrentTask());
  ipcMain.handle(ipcChannels.learningTerminateLearning, () => appService.terminateLearning());
  ipcMain.handle(ipcChannels.learningAskQuestion, (_event, payload) =>
    appService.askStepQuestion(payload.question, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningResolveQuestion, (_event, payload) =>
    appService.resolveQuestion(payload.threadId, payload?.summary)
  );
  ipcMain.handle(ipcChannels.learningSubmitResult, (_event, payload) =>
    appService.submitLearningResult(payload.content, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningRetrySubmissionEvaluation, (_event, payload) =>
    appService.retrySubmissionEvaluation(payload.submissionId, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningDecideAdjustment, (_event, payload) =>
    appService.decidePlanAdjustment(payload.proposalId, payload.status)
  );
  ipcMain.handle(ipcChannels.reviewsGenerate, (_event, payload) => appService.generateReview(payload.date));
  ipcMain.handle(ipcChannels.reviewsGetLatest, (_event, payload) => appService.getLatestReview(payload?.date));
  ipcMain.handle(ipcChannels.reviewsApplyAdjustments, (_event, payload) => appService.applyReviewPlanAdjustments(payload));
  ipcMain.handle(ipcChannels.knowledgeListForGoal, (_event, payload) => appService.getKnowledgeItemsForGoal(payload));
  ipcMain.handle(ipcChannels.systemAuditRuntime, () => appService.auditRuntimeConsistency());
  ipcMain.handle(ipcChannels.dataExportGoal, (_event, payload) => appService.exportGoalData(payload.goalId));
  ipcMain.handle(ipcChannels.promptsList, () => appService.listPrompts());
  ipcMain.handle(ipcChannels.promptsUpdate, (_event, payload) =>
    appService.updatePrompt(payload.profileId, payload.content)
  );
  ipcMain.handle(ipcChannels.sessionGetActive, () => appService.getActiveSession());
  ipcMain.handle(ipcChannels.historyListAll, () => appService.listHistory());
  ipcMain.handle(ipcChannels.historyGetById, (_event, payload) => appService.getHistoryIntake(payload.intakeId));
}
