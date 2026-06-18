import { ipcMain } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type { AppService } from './services/app-service';

export function registerIpcHandlers(appService: AppService): void {
  ipcMain.handle(ipcChannels.settingsGet, () => appService.getSettings());
  ipcMain.handle(ipcChannels.settingsUpdate, (_event, patch) => appService.updateSettings(patch));
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
  ipcMain.handle(ipcChannels.reviewsGenerate, (_event, payload) => appService.generateReview(payload.date));
  ipcMain.handle(ipcChannels.promptsList, () => appService.listPrompts());
  ipcMain.handle(ipcChannels.promptsUpdate, (_event, payload) =>
    appService.updatePrompt(payload.profileId, payload.content)
  );
}
