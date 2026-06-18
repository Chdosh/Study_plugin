import type { BrowserWindow } from 'electron';
import type { AppSettings, Id, RawImport, StudyWindow, TaskItem } from '../../shared/types';
import { AiClient } from '../ai/ai-client';
import { ImportAgent, PlannerAgent, ReflectionAgent } from '../ai/agents';
import { FocusMonitor } from './focus-monitor';
import type { SettingsService } from './settings-service';
import type { StudyStore } from './store';

export class AppService {
  private readonly aiClient = new AiClient();
  private readonly importAgent = new ImportAgent(this.aiClient);
  private readonly plannerAgent = new PlannerAgent(this.aiClient);
  private readonly reflectionAgent = new ReflectionAgent(this.aiClient);
  private readonly focusMonitor: FocusMonitor;

  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {
    this.focusMonitor = new FocusMonitor(store);
  }

  getSettings() {
    return this.settings.getAppSettings();
  }

  updateSettings(patch: Partial<AppSettings> & { deepseekApiKey?: string }) {
    return this.settings.updateSettings(patch);
  }

  createImport(rawText: string, source: RawImport['source']) {
    if (!rawText.trim()) {
      throw new Error('Import text is required.');
    }
    return this.store.createRawImport(rawText, source);
  }

  async parseImport(importId: Id, promptProfileId?: Id) {
    const [rawImport, profile, runtimeSettings] = await Promise.all([
      this.store.getRawImport(importId),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    try {
      const output = await this.importAgent.run(rawImport.rawText, profile, runtimeSettings);
      const tasks = await this.store.saveParsedImport(importId, output);
      await this.store.saveAiReview({
        kind: 'import',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          importId,
          rawText: rawImport.rawText
        },
        output,
        outputSchemaVersion: 'import.v1',
        status: 'success'
      });
      return {
        importId,
        goalsCreated: output.goals.length,
        tasksCreated: tasks.length,
        tasks
      };
    } catch (error) {
      await this.store.saveAiReview({
        kind: 'import',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { importId },
        output: {},
        outputSchemaVersion: 'import.v1',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  listTasks() {
    return this.store.listTasks();
  }

  updateTask(taskId: Id, patch: Partial<TaskItem>) {
    return this.store.updateTask(taskId, patch);
  }

  listPlans(date?: string) {
    return this.store.listPlans(date);
  }

  async generatePlan(date: string, availableWindows: StudyWindow[], promptProfileId?: Id) {
    const [tasks, profile, runtimeSettings] = await Promise.all([
      this.store.listTasks(),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    const unresolvedTasks = tasks.filter((task) => !['done', 'skipped'].includes(task.status));
    if (unresolvedTasks.length === 0) {
      throw new Error('No unresolved tasks are available for planning.');
    }
    const output = await this.plannerAgent.run({
      date,
      windows: availableWindows,
      tasks: unresolvedTasks,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'plan',
      date,
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: {
        date,
        availableWindows,
        tasks: unresolvedTasks
      },
      output,
      outputSchemaVersion: 'daily-plan.v1',
      status: 'success'
    });
    return this.store.createPlanFromAgentOutput({
      date,
      availableWindowsJson: JSON.stringify(availableWindows),
      output
    });
  }

  confirmPlan(planId: Id) {
    return this.store.confirmPlan(planId);
  }

  async startSession(blockId: Id) {
    const session = await this.store.startSession(blockId);
    this.focusMonitor.start(session.id);
    this.getMainWindow()?.flashFrame(true);
    return session;
  }

  async pauseSession(sessionId: Id) {
    this.focusMonitor.stop();
    return this.store.pauseSession(sessionId);
  }

  async completeSession(sessionId: Id, notes?: string) {
    this.focusMonitor.stop();
    return this.store.completeSession(sessionId, notes);
  }

  async skipBlock(blockId: Id, reason: string) {
    if (!reason.trim()) {
      throw new Error('Skip reason is required.');
    }
    return this.store.skipBlock(blockId, reason);
  }

  async generateReview(date: string) {
    const [snapshot, profile, runtimeSettings] = await Promise.all([
      this.store.getDaySnapshot(date),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const output = await this.reflectionAgent.run({
      date,
      snapshot,
      profile,
      settings: runtimeSettings
    });
    const reviewId = await this.store.saveAiReview({
      kind: 'reflection',
      date,
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: snapshot,
      output,
      outputSchemaVersion: 'review.v1',
      status: 'success'
    });
    return {
      reviewId,
      date,
      ...output
    };
  }

  listPrompts() {
    return this.store.listPromptProfiles();
  }

  updatePrompt(profileId: Id, content: string) {
    return this.store.updatePrompt(profileId, content);
  }
}
