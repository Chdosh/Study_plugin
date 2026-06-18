export const ipcChannels = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  importsCreate: 'imports:create',
  importsParse: 'imports:parse',
  tasksList: 'tasks:list',
  tasksUpdate: 'tasks:update',
  plansList: 'plans:list',
  plansGenerate: 'plans:generate',
  plansConfirm: 'plans:confirm',
  sessionsStart: 'sessions:start',
  sessionsPause: 'sessions:pause',
  sessionsComplete: 'sessions:complete',
  sessionsSkip: 'sessions:skip',
  reviewsGenerate: 'reviews:generate',
  promptsList: 'prompts:list',
  promptsUpdate: 'prompts:update'
} as const;
