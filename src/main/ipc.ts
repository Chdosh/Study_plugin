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
  ipcMain.handle(ipcChannels.onboardingCancelQuestion, () =>
    appService.cancelOnboardingQuestion()
  );
  ipcMain.handle(ipcChannels.onboardingGenerateInitialPlan, (_event, payload) =>
    appService.generateInitialLearningPlan(payload?.briefPatch)
  );
  ipcMain.handle(ipcChannels.guidesConfirmLearningGuide, (_event, payload) =>
    appService.confirmLearningGuide(payload.guideId)
  );
  ipcMain.handle(ipcChannels.guidesResetLearningWorkspace, () => appService.resetLearningWorkspace());
  ipcMain.handle(ipcChannels.guidesPrepareCurrentLearningUnit, (_event, payload) =>
    appService.prepareCurrentLearningUnit(payload?.forceRetry)
  );
  ipcMain.handle(ipcChannels.guidesGenerateRollingPlan, (_event, payload) =>
    appService.generateRollingPlan(payload.goalId)
  );
  ipcMain.handle(ipcChannels.guidesListResumable, () => appService.listResumableGuides());
  ipcMain.handle(ipcChannels.guidesRestoreArchived, (_event, payload) =>
    appService.restoreArchivedGuide(payload.guideId)
  );
  ipcMain.handle(ipcChannels.guidesGetOverview, () => appService.getOverview());
  ipcMain.handle(ipcChannels.sessionsStart, (_event, payload) => appService.startSession(payload.taskId));
  ipcMain.handle(ipcChannels.sessionsPause, (_event, payload) => appService.pauseSession(payload.sessionId));
  ipcMain.handle(ipcChannels.sessionsEnd, (_event, payload) => appService.endSession(payload.sessionId));
  ipcMain.handle(ipcChannels.learningGetState, () => appService.getLearningState());
  ipcMain.handle(ipcChannels.learningTeachCurrentStep, (_event, payload) =>
    appService.teachCurrentStep(payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningResumeTurn, (_event, payload) =>
    appService.resumeLearningTurn(
      payload.pendingInteractionId,
      payload.answer,
      payload.expectedContextVersion
    )
  );
  ipcMain.handle(ipcChannels.learningCancelTurn, (_event, payload) =>
    appService.cancelLearningTurn(payload.pendingInteractionId)
  );
  ipcMain.handle(ipcChannels.learningCompleteCurrentAction, (_event, payload) =>
    appService.completeCurrentAction(payload.actionId, payload?.note)
  );
  ipcMain.handle(ipcChannels.learningSkipCurrentAction, (_event, payload) =>
    appService.skipCurrentAction(payload.actionId)
  );
  ipcMain.handle(ipcChannels.learningAskQuestion, (_event, payload) =>
    appService.askStepQuestion(payload.question, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningAskTemporaryQuestion, (_event, payload) =>
    appService.askTemporaryQuestion(payload.question, payload?.promptProfileId, payload?.threadId)
  );
  ipcMain.handle(ipcChannels.learningGetLatestTemporaryQuestion, () =>
    appService.getLatestTemporaryQuestion()
  );
  ipcMain.handle(ipcChannels.learningLinkTemporaryQuestionToGoal, (_event, payload) =>
    appService.linkTemporaryQuestionToGoal(payload.threadId, payload.goalId)
  );
  ipcMain.handle(ipcChannels.learningKeepTemporaryQuestion, (_event, payload) =>
    appService.keepTemporaryQuestion(payload.threadId)
  );
  ipcMain.handle(ipcChannels.learningConvertTemporaryQuestionToTask, (_event, payload) =>
    appService.convertTemporaryQuestionToTask(payload.threadId, payload.goalId)
  );
  ipcMain.handle(ipcChannels.learningResolveQuestion, (_event, payload) =>
    appService.resolveQuestion(payload.threadId, payload?.summary)
  );
  ipcMain.handle(ipcChannels.learningSubmitResult, (_event, payload) =>
    appService.submitLearningResult(payload.content, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningRetryEvaluation, (_event, payload) =>
    appService.retrySubmissionEvaluation(payload.submissionId)
  );
  ipcMain.handle(ipcChannels.learningCorrectEvaluation, (_event, payload) =>
    appService.recordEvaluationCorrection(payload.evaluationId, payload.reason)
  );
  ipcMain.handle(ipcChannels.learningDecideAdjustment, (_event, payload) =>
    appService.decidePlanAdjustment(payload.proposalId, payload.status)
  );
  ipcMain.handle(ipcChannels.learningDecideEvaluationRecommendation, (_event, payload) =>
    appService.decideEvaluationRecommendation(
      payload.evaluationId,
      payload.decision,
      payload?.reason
    )
  );
  ipcMain.handle(ipcChannels.reviewsGenerate, (_event, payload) => appService.generateReview(payload.date));
  ipcMain.handle(ipcChannels.reviewsGetLatest, (_event, payload) => appService.getLatestReview(payload?.date));
  ipcMain.handle(ipcChannels.knowledgeListForGoal, (_event, payload) => appService.getKnowledgeItemsForGoal(payload));
  ipcMain.handle(ipcChannels.knowledgeSetStatus, (_event, payload) =>
    appService.setKnowledgeItemStatus(payload.itemId, payload.status)
  );
  ipcMain.handle(ipcChannels.learnerContextProposeFact, (_event, payload) => appService.proposeLearnerFact(payload.goalId, payload.fact));
  ipcMain.handle(ipcChannels.learnerContextListForGoal, (_event, payload) => appService.listLearnerFacts(payload.goalId, payload?.scope));
  ipcMain.handle(ipcChannels.learnerContextConfirmFact, (_event, payload) => appService.confirmLearnerFact(payload.goalId, payload.key, payload.scope, payload.taskId));
  ipcMain.handle(ipcChannels.learnerContextDeleteFact, (_event, payload) => appService.deleteLearnerFact(payload.goalId, payload.key, payload.scope, payload.taskId));
  ipcMain.handle(ipcChannels.systemAuditRuntime, () => appService.auditRuntimeConsistency());
  ipcMain.handle(ipcChannels.systemSelectCurrentGuide, (_event, payload) => appService.selectCurrentGuide(payload.guideId));
  ipcMain.handle(ipcChannels.systemResolveLearningUnit, (_event, payload) =>
    appService.resolveLearningUnit(payload.guideId, payload.decision)
  );
  ipcMain.handle(ipcChannels.dataExportGoal, (_event, payload) => appService.exportGoalData(payload.goalId));
  ipcMain.handle(ipcChannels.dataListGoals, () => appService.listGoals());
  ipcMain.handle(ipcChannels.dataGetPlanVersions, (_event, payload) => appService.getPlanVersionsForGoal(payload.goalId));
  ipcMain.handle(ipcChannels.dataCreatePlanProposal, (_event, payload) => appService.createPlanProposal(payload.goalId, payload.proposal));
  ipcMain.handle(ipcChannels.dataConfirmPlanProposal, (_event, payload) => appService.confirmPlanProposal(payload.proposalId));
  ipcMain.handle(ipcChannels.dataConfirmRoadmapStage, (_event, payload) => appService.confirmRoadmapStage(payload.goalId, payload.stageId));
  ipcMain.handle(ipcChannels.sessionGetActive, () => appService.getActiveSession());
  ipcMain.handle(ipcChannels.statsGetTokenCost, (_event, payload) => appService.getTokenCostStats(payload ?? {}));
}
