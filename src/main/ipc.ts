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
  ipcMain.handle(ipcChannels.sessionsSkip, () => appService.skipCurrentTask());
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
  ipcMain.handle(ipcChannels.knowledgeListForGoal, (_event, payload) => appService.getKnowledgeItemsForGoal(payload));
  ipcMain.handle(ipcChannels.learnerContextProposeFact, (_event, payload) => appService.proposeLearnerFact(payload.goalId, payload.fact));
  ipcMain.handle(ipcChannels.learnerContextListForGoal, (_event, payload) => appService.listLearnerFacts(payload.goalId, payload?.scope));
  ipcMain.handle(ipcChannels.learnerContextConfirmFact, (_event, payload) => appService.confirmLearnerFact(payload.goalId, payload.key, payload.scope, payload.taskId));
  ipcMain.handle(ipcChannels.learnerContextDeleteFact, (_event, payload) => appService.deleteLearnerFact(payload.goalId, payload.key, payload.scope, payload.taskId));
  ipcMain.handle(ipcChannels.branchOpen, (_event, payload) => appService.createBranch(payload.kind, payload.anchor, payload.initialContent));
  ipcMain.handle(ipcChannels.branchAppend, (_event, payload) => appService.appendBranchMessage(payload.threadId, payload.role, payload.content));
  ipcMain.handle(ipcChannels.branchClose, (_event, payload) => appService.closeBranch(payload.threadId, payload.strategy, payload.options));
  ipcMain.handle(ipcChannels.branchPromote, (_event, payload) => appService.promoteBranch(payload.threadId, payload.taskId, payload.summary));
  ipcMain.handle(ipcChannels.branchGetThread, (_event, payload) => appService.getBranchThread(payload.threadId));
  ipcMain.handle(ipcChannels.branchGetMessages, (_event, payload) => appService.getBranchMessages(payload.threadId));
  ipcMain.handle(ipcChannels.systemAuditRuntime, () => appService.auditRuntimeConsistency());
  ipcMain.handle(ipcChannels.systemSelectCurrentGuide, (_event, payload) => appService.selectCurrentGuide(payload.guideId));
  ipcMain.handle(ipcChannels.dataExportGoal, (_event, payload) => appService.exportGoalData(payload.goalId));
  ipcMain.handle(ipcChannels.dataGetPlanVersions, (_event, payload) => appService.getPlanVersionsForGoal(payload.goalId));
  ipcMain.handle(ipcChannels.dataCreatePlanProposal, (_event, payload) => appService.createPlanProposal(payload.goalId, payload.proposal));
  ipcMain.handle(ipcChannels.dataConfirmPlanProposal, (_event, payload) => appService.confirmPlanProposal(payload.proposalId));
  ipcMain.handle(ipcChannels.dataRejectPlanProposal, (_event, payload) => appService.rejectPlanProposal(payload.proposalId));
  ipcMain.handle(ipcChannels.dataConfirmRoadmapStage, (_event, payload) => appService.confirmRoadmapStage(payload.goalId, payload.stageId));
  ipcMain.handle(ipcChannels.promptsList, () => appService.listPrompts());
  ipcMain.handle(ipcChannels.promptsUpdate, (_event, payload) =>
    appService.updatePrompt(payload.profileId, payload.content)
  );
  ipcMain.handle(ipcChannels.sessionGetActive, () => appService.getActiveSession());
  ipcMain.handle(ipcChannels.historyListAll, () => appService.listHistory());
  ipcMain.handle(ipcChannels.historyGetById, (_event, payload) => appService.getHistoryIntake(payload.intakeId));
  ipcMain.handle(ipcChannels.statsGetTokenCost, (_event, payload) => appService.getTokenCostStats(payload ?? {}));
}
