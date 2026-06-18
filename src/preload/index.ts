import { contextBridge, ipcRenderer } from 'electron';
import { ipcChannels } from '../shared/ipc';
import type { AppSettings, Id, RawImport, StudyAppApi, StudyWindow, TaskItem } from '../shared/types';

const api: StudyAppApi = {
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (patch: Partial<AppSettings> & { deepseekApiKey?: string }) =>
      ipcRenderer.invoke(ipcChannels.settingsUpdate, patch)
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
  plans: {
    list: (date?: string) => ipcRenderer.invoke(ipcChannels.plansList, { date }),
    generate: (date: string, availableWindows: StudyWindow[], promptProfileId?: Id) =>
      ipcRenderer.invoke(ipcChannels.plansGenerate, { date, availableWindows, promptProfileId }),
    confirm: (planId: Id) => ipcRenderer.invoke(ipcChannels.plansConfirm, { planId })
  },
  sessions: {
    start: (blockId: Id) => ipcRenderer.invoke(ipcChannels.sessionsStart, { blockId }),
    pause: (sessionId: Id) => ipcRenderer.invoke(ipcChannels.sessionsPause, { sessionId }),
    complete: (sessionId: Id, notes?: string) =>
      ipcRenderer.invoke(ipcChannels.sessionsComplete, { sessionId, notes }),
    skip: (blockId: Id, reason: string) => ipcRenderer.invoke(ipcChannels.sessionsSkip, { blockId, reason })
  },
  reviews: {
    generate: (date: string) => ipcRenderer.invoke(ipcChannels.reviewsGenerate, { date })
  },
  prompts: {
    list: () => ipcRenderer.invoke(ipcChannels.promptsList),
    update: (profileId: Id, content: string) =>
      ipcRenderer.invoke(ipcChannels.promptsUpdate, { profileId, content })
  }
};

contextBridge.exposeInMainWorld('studyApp', api);
