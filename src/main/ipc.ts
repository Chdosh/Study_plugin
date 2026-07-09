import { BrowserWindow, ipcMain } from 'electron';
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
  ipcMain.handle(ipcChannels.guidesListToday, () => appService.listTodayGuide());
  ipcMain.handle(ipcChannels.importsCreate, (_event, payload) =>
    appService.createImport(payload.rawText, payload.source)
  );
  ipcMain.handle(ipcChannels.importsParse, (_event, payload) =>
    appService.parseImport(payload.importId, payload.promptProfileId)
  );
  ipcMain.handle(ipcChannels.tasksList, () => appService.listTasks());
  ipcMain.handle(ipcChannels.tasksUpdate, (_event, payload) =>
    appService.updateTask(payload.taskId, payload.patch)
  );
  ipcMain.handle(ipcChannels.goalsList, () => appService.listGoals());
  ipcMain.handle(ipcChannels.goalsCreate, (_event, payload) =>
    appService.createGoal(payload.title, payload?.description)
  );
  ipcMain.handle(ipcChannels.goalsListStages, (_event, payload) => appService.listStages(payload?.goalId));
  ipcMain.handle(ipcChannels.goalsGenerateStages, (_event, payload) =>
    appService.generateStageOutline(payload?.goalId, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.goalsConfirmStages, (_event, payload) => appService.confirmStages(payload.goalId));
  ipcMain.handle(ipcChannels.plansList, (_event, payload) => appService.listPlans(payload?.date));
  ipcMain.handle(ipcChannels.plansGenerate, (_event, payload) =>
    appService.generatePlan(payload.date, payload.availableWindows, payload.promptProfileId)
  );
  ipcMain.handle(ipcChannels.plansConfirm, (_event, payload) => appService.confirmPlan(payload.planId));
  ipcMain.handle(ipcChannels.sessionsStart, (_event, payload) => appService.startSession(payload.blockId));
  ipcMain.handle(ipcChannels.sessionsPause, (_event, payload) => appService.pauseSession(payload.sessionId));
  ipcMain.handle(ipcChannels.sessionsComplete, (_event, payload) =>
    appService.completeSession(payload.sessionId, payload.notes)
  );
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
  ipcMain.handle(ipcChannels.learningAskQuestion, (_event, payload) =>
    appService.askStepQuestion(payload.question, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningResolveQuestion, (_event, payload) =>
    appService.resolveQuestion(payload.threadId, payload?.summary)
  );
  ipcMain.handle(ipcChannels.learningSubmitResult, (_event, payload) =>
    appService.submitLearningResult(payload.content, payload?.promptProfileId)
  );
  ipcMain.handle(ipcChannels.learningDecideAdjustment, (_event, payload) =>
    appService.decidePlanAdjustment(payload.proposalId, payload.status)
  );
  ipcMain.handle(ipcChannels.reviewsGenerate, (_event, payload) => appService.generateReview(payload.date));
  ipcMain.handle(ipcChannels.promptsList, () => appService.listPrompts());
  ipcMain.handle(ipcChannels.promptsUpdate, (_event, payload) =>
    appService.updatePrompt(payload.profileId, payload.content)
  );
  ipcMain.handle(ipcChannels.sessionGetActive, () => appService.getActiveSession());
  ipcMain.handle(ipcChannels.floatGetPosition, () => appService.getFloatPosition());
  ipcMain.handle(ipcChannels.floatSavePosition, (_event, payload) =>
    appService.saveFloatPosition(payload.x, payload.y)
  );
  ipcMain.handle(ipcChannels.floatOpenMain, async () => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed() && !win.getTitle().includes('浮窗')) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send(ipcChannels.navigateToPage, 'study');
        const active = await appService.getActiveSession();
        if (active) {
          await appService.pushSessionState(active.session);
        }
        break;
      }
    }
  });
  ipcMain.handle(ipcChannels.floatResize, (_event, payload: { width: number; height: number }) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (win && !win.isDestroyed()) {
      win.setSize(payload.width, payload.height);
    }
  });
  ipcMain.handle(ipcChannels.floatMove, (_event, payload: { deltaX: number; deltaY: number }) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      win.setPosition(x + payload.deltaX, y + payload.deltaY);
    }
  });
}
