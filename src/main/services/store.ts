import { asc, desc, eq } from 'drizzle-orm';
import type {
  DailyPlan,
  DailyPlanBlock,
  PromptProfile,
  RawImport,
  StudySession,
  TaskItem
} from '../../shared/types';
import type { DailyPlanAgentOutput, ImportAgentOutput, ReviewAgentOutput } from '../../shared/schemas';
import { defaultPromptProfiles } from '../db/default-prompts';
import type { Database } from '../db/client';
import {
  aiReviews,
  appSettings,
  dailyPlanBlocks,
  dailyPlans,
  focusEvents,
  goals,
  planVersions,
  promptProfiles,
  promptVersions,
  rawImports,
  skipLogs,
  studySessions,
  taskDependencies,
  taskItems
} from '../db/schema';
import { createId, nowIso } from './id';

export class StudyStore {
  constructor(private readonly db: Database) {}

  async seedDefaults(): Promise<void> {
    const now = nowIso();
    for (const prompt of defaultPromptProfiles) {
      const existing = await this.db
        .select()
        .from(promptProfiles)
        .where(eq(promptProfiles.key, prompt.key))
        .limit(1);
      if (existing.length > 0) continue;

      const profileId = createId('prompt_profile');
      const versionId = createId('prompt_version');
      await this.db.insert(promptProfiles).values({
        id: profileId,
        key: prompt.key,
        name: prompt.name,
        description: prompt.description,
        activeVersionId: versionId,
        createdAt: now,
        updatedAt: now
      });
      await this.db.insert(promptVersions).values({
        id: versionId,
        profileId,
        version: 1,
        content: prompt.content,
        createdAt: now
      });
    }

    await this.putSettingIfMissing('deepseekBaseUrl', 'https://api.deepseek.com');
    await this.putSettingIfMissing('deepseekModel', 'deepseek-chat');
    await this.putSettingIfMissing('autoLaunch', 'false');
    await this.putSettingIfMissing('defaultBlockMinutes', '10');
    await this.putSettingIfMissing(
      'dailyStudyWindows',
      JSON.stringify([
        {
          start: '20:00',
          end: '22:00'
        }
      ])
    );
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async putSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value,
          updatedAt: nowIso()
        }
      });
  }

  private async putSettingIfMissing(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing === null) {
      await this.putSetting(key, value);
    }
  }

  async createRawImport(rawText: string, source: RawImport['source']): Promise<RawImport> {
    const row = {
      id: createId('import'),
      source,
      rawText,
      status: 'created' as const,
      createdAt: nowIso(),
      parsedAt: null
    };
    await this.db.insert(rawImports).values({
      id: row.id,
      source: row.source,
      rawText: row.rawText,
      status: row.status,
      createdAt: row.createdAt,
      parsedAt: row.parsedAt
    });
    return row;
  }

  async getRawImport(importId: string): Promise<RawImport> {
    const rows = await this.db.select().from(rawImports).where(eq(rawImports.id, importId)).limit(1);
    if (!rows[0]) throw new Error(`Import not found: ${importId}`);
    return mapRawImport(rows[0]);
  }

  async saveParsedImport(importId: string, output: ImportAgentOutput): Promise<TaskItem[]> {
    const now = nowIso();
    const goalByTitle = new Map<string, string>();

    for (const goal of output.goals) {
      const id = createId('goal');
      goalByTitle.set(goal.title, id);
      await this.db.insert(goals).values({
        id,
        sourceImportId: importId,
        title: goal.title,
        description: goal.description,
        status: 'active',
        priority: goal.priority,
        dueDate: goal.dueDate,
        createdAt: now,
        updatedAt: now
      });
    }

    const taskByTitle = new Map<string, string>();
    const createdTasks: TaskItem[] = [];
    for (const task of output.tasks) {
      const id = createId('task');
      taskByTitle.set(task.title, id);
      const row = {
        id,
        goalId: task.goalTitle ? (goalByTitle.get(task.goalTitle) ?? null) : null,
        sourceImportId: importId,
        title: task.title,
        description: task.description || null,
        status: 'backlog' as const,
        priority: task.priority,
        difficulty: task.difficulty,
        estimateMinutes: task.estimateMinutes,
        acceptanceCriteria: task.acceptanceCriteria || null,
        createdAt: now,
        updatedAt: now
      };
      await this.db.insert(taskItems).values(row);
      createdTasks.push(mapTask(row));
    }

    for (const task of output.tasks) {
      const taskId = taskByTitle.get(task.title);
      if (!taskId) continue;
      for (const dependencyTitle of task.dependsOnTitles) {
        const dependsOnTaskId = taskByTitle.get(dependencyTitle);
        if (!dependsOnTaskId) continue;
        await this.db
          .insert(taskDependencies)
          .values({
            id: createId('dependency'),
            taskId,
            dependsOnTaskId,
            createdAt: now
          })
          .onConflictDoNothing();
      }
    }

    await this.db
      .update(rawImports)
      .set({ status: 'parsed', parsedAt: now })
      .where(eq(rawImports.id, importId));

    return createdTasks;
  }

  async listTasks(): Promise<TaskItem[]> {
    const rows = await this.db.select().from(taskItems).orderBy(desc(taskItems.createdAt));
    return rows.map(mapTask);
  }

  async updateTask(taskId: string, patch: Partial<TaskItem>): Promise<TaskItem> {
    await this.db
      .update(taskItems)
      .set({
        title: patch.title,
        description: patch.description,
        status: patch.status,
        priority: patch.priority,
        difficulty: patch.difficulty,
        estimateMinutes: patch.estimateMinutes,
        acceptanceCriteria: patch.acceptanceCriteria,
        updatedAt: nowIso()
      })
      .where(eq(taskItems.id, taskId));
    const rows = await this.db.select().from(taskItems).where(eq(taskItems.id, taskId)).limit(1);
    if (!rows[0]) throw new Error(`Task not found after update: ${taskId}`);
    return mapTask(rows[0]);
  }

  async listPlans(date?: string): Promise<DailyPlan[]> {
    const planRows = date
      ? await this.db.select().from(dailyPlans).where(eq(dailyPlans.date, date)).orderBy(desc(dailyPlans.createdAt))
      : await this.db.select().from(dailyPlans).orderBy(desc(dailyPlans.createdAt));

    const plans: DailyPlan[] = [];
    for (const plan of planRows) {
      const blocks = await this.db
        .select()
        .from(dailyPlanBlocks)
        .where(eq(dailyPlanBlocks.planId, plan.id))
        .orderBy(asc(dailyPlanBlocks.position));
      plans.push({
        id: plan.id,
        date: plan.date,
        status: plan.status,
        availableWindowsJson: plan.availableWindowsJson,
        createdAt: plan.createdAt,
        confirmedAt: plan.confirmedAt,
        version: plan.version,
        blocks: blocks.map(mapPlanBlock)
      });
    }
    return plans;
  }

  async createPlanFromAgentOutput(params: {
    date: string;
    availableWindowsJson: string;
    output: DailyPlanAgentOutput;
  }): Promise<DailyPlan> {
    const now = nowIso();
    const planId = createId('plan');
    const tasks = await this.listTasks();
    const taskByTitle = new Map(tasks.map((task) => [task.title, task.id]));

    await this.db.insert(dailyPlans).values({
      id: planId,
      date: params.date,
      status: 'draft',
      availableWindowsJson: params.availableWindowsJson,
      createdAt: now,
      confirmedAt: null,
      sourceReviewId: null,
      version: 1
    });

    let position = 0;
    for (const block of params.output.blocks) {
      await this.db.insert(dailyPlanBlocks).values({
        id: createId('block'),
        planId,
        taskId: block.taskTitle ? (taskByTitle.get(block.taskTitle) ?? null) : null,
        startTime: block.startTime,
        endTime: block.endTime,
        durationMinutes: block.durationMinutes,
        objective: block.objective,
        action: block.action,
        expectedOutput: block.expectedOutput,
        difficulty: block.difficulty,
        material: block.material,
        successCheck: block.successCheck,
        fallback: block.fallback,
        status: 'planned',
        position: position++
      });
    }

    await this.db.insert(planVersions).values({
      id: createId('plan_version'),
      planId,
      version: 1,
      changeSummary: 'Initial AI-generated draft plan.',
      snapshotJson: JSON.stringify(params.output),
      createdAt: now
    });

    return (await this.listPlans(params.date)).find((plan) => plan.id === planId)!;
  }

  async confirmPlan(planId: string): Promise<DailyPlan> {
    await this.db
      .update(dailyPlans)
      .set({
        status: 'confirmed',
        confirmedAt: nowIso()
      })
      .where(eq(dailyPlans.id, planId));
    const plans = await this.listPlans();
    const plan = plans.find((item) => item.id === planId);
    if (!plan) throw new Error(`Plan not found after confirm: ${planId}`);
    return plan;
  }

  async startSession(blockId: string): Promise<StudySession> {
    const blocks = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    if (!blocks[0]) throw new Error(`Block not found: ${blockId}`);
    await this.db.update(dailyPlanBlocks).set({ status: 'active' }).where(eq(dailyPlanBlocks.id, blockId));
    const row = {
      id: createId('session'),
      blockId,
      taskId: blocks[0].taskId,
      startedAt: nowIso(),
      endedAt: null,
      durationMinutes: null,
      status: 'active' as const,
      focusScore: null,
      notes: null
    };
    await this.db.insert(studySessions).values(row);
    return row;
  }

  async pauseSession(sessionId: string): Promise<StudySession> {
    return this.finishSession(sessionId, 'paused');
  }

  async completeSession(sessionId: string, notes?: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'completed', notes);
    if (session.blockId) {
      await this.db.update(dailyPlanBlocks).set({ status: 'done' }).where(eq(dailyPlanBlocks.id, session.blockId));
    }
    if (session.taskId) {
      await this.db
        .update(taskItems)
        .set({ status: 'done', updatedAt: nowIso() })
        .where(eq(taskItems.id, session.taskId));
    }
    return session;
  }

  async skipBlock(blockId: string, reason: string): Promise<void> {
    const blocks = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    if (!blocks[0]) throw new Error(`Block not found: ${blockId}`);
    await this.db.update(dailyPlanBlocks).set({ status: 'skipped' }).where(eq(dailyPlanBlocks.id, blockId));
    await this.db.insert(skipLogs).values({
      id: createId('skip'),
      blockId,
      taskId: blocks[0].taskId,
      reason,
      createdAt: nowIso()
    });
  }

  async recordFocusEvent(params: {
    sessionId: string | null;
    appName: string;
    windowTitle: string | null;
    eventType: 'foreground' | 'away' | 'return' | 'unknown';
    durationSeconds?: number;
  }): Promise<void> {
    await this.db.insert(focusEvents).values({
      id: createId('focus'),
      sessionId: params.sessionId,
      appName: params.appName,
      windowTitle: params.windowTitle,
      eventType: params.eventType,
      startedAt: nowIso(),
      endedAt: null,
      durationSeconds: params.durationSeconds
    });
  }

  private async finishSession(
    sessionId: string,
    status: 'paused' | 'completed',
    notes?: string
  ): Promise<StudySession> {
    const rows = await this.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
    const existing = rows[0];
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    const endedAt = nowIso();
    const durationMinutes = Math.max(
      0,
      Math.round((new Date(endedAt).getTime() - new Date(existing.startedAt).getTime()) / 60000)
    );
    await this.db
      .update(studySessions)
      .set({
        endedAt,
        durationMinutes,
        status,
        notes: notes ?? existing.notes
      })
      .where(eq(studySessions.id, sessionId));
    const updated = await this.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
    return mapSession(updated[0]);
  }

  async listPromptProfiles(): Promise<PromptProfile[]> {
    const profiles = await this.db.select().from(promptProfiles).orderBy(asc(promptProfiles.name));
    const results: PromptProfile[] = [];
    for (const profile of profiles) {
      const versions = await this.db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.profileId, profile.id))
        .orderBy(desc(promptVersions.version))
        .limit(1);
      const active = versions[0];
      results.push({
        id: profile.id,
        key: profile.key,
        name: profile.name,
        description: profile.description,
        activeVersionId: profile.activeVersionId,
        version: active?.version ?? 0,
        content: active?.content ?? ''
      });
    }
    return results;
  }

  async getPromptProfile(profileId?: string): Promise<PromptProfile> {
    const profiles = await this.listPromptProfiles();
    const selected = profileId
      ? profiles.find((profile) => profile.id === profileId)
      : profiles.find((profile) => profile.key === 'foundation') ?? profiles[0];
    if (!selected) throw new Error('No prompt profiles exist.');
    return selected;
  }

  async updatePrompt(profileId: string, content: string): Promise<PromptProfile> {
    const versions = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.profileId, profileId))
      .orderBy(desc(promptVersions.version))
      .limit(1);
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    const versionId = createId('prompt_version');
    const now = nowIso();
    await this.db.insert(promptVersions).values({
      id: versionId,
      profileId,
      version: nextVersion,
      content,
      createdAt: now
    });
    await this.db
      .update(promptProfiles)
      .set({ activeVersionId: versionId, updatedAt: now })
      .where(eq(promptProfiles.id, profileId));
    return this.getPromptProfile(profileId);
  }

  async saveAiReview(params: {
    kind: 'import' | 'plan' | 'evaluation' | 'replan' | 'reflection';
    date?: string;
    provider: string;
    model: string;
    promptProfileId?: string;
    promptVersionId?: string | null;
    inputSnapshot: unknown;
    output: unknown;
    outputSchemaVersion: string;
    status: 'success' | 'failed';
    errorMessage?: string;
  }): Promise<string> {
    const id = createId('ai_review');
    await this.db.insert(aiReviews).values({
      id,
      kind: params.kind,
      date: params.date,
      provider: params.provider,
      model: params.model,
      promptProfileId: params.promptProfileId,
      promptVersionId: params.promptVersionId,
      inputSnapshotJson: JSON.stringify(params.inputSnapshot),
      outputJson: JSON.stringify(params.output),
      outputSchemaVersion: params.outputSchemaVersion,
      status: params.status,
      errorMessage: params.errorMessage,
      createdAt: nowIso()
    });
    return id;
  }

  async createReview(date: string, output: ReviewAgentOutput): Promise<string> {
    return this.saveAiReview({
      kind: 'reflection',
      date,
      provider: 'deepseek',
      model: 'configured',
      inputSnapshot: { date },
      output,
      outputSchemaVersion: 'review.v1',
      status: 'success'
    });
  }

  async getDaySnapshot(date: string) {
    const plans = await this.listPlans(date);
    const tasks = await this.listTasks();
    const sessions = await this.db.select().from(studySessions).orderBy(desc(studySessions.startedAt));
    return {
      date,
      plans,
      tasks,
      sessions: sessions.map(mapSession)
    };
  }
}

function mapRawImport(row: typeof rawImports.$inferSelect): RawImport {
  return {
    id: row.id,
    source: row.source,
    rawText: row.rawText,
    status: row.status,
    createdAt: row.createdAt,
    parsedAt: row.parsedAt
  };
}

function mapTask(row: typeof taskItems.$inferSelect): TaskItem {
  return {
    id: row.id,
    goalId: row.goalId,
    sourceImportId: row.sourceImportId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    difficulty: row.difficulty,
    estimateMinutes: row.estimateMinutes,
    acceptanceCriteria: row.acceptanceCriteria,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapPlanBlock(row: typeof dailyPlanBlocks.$inferSelect): DailyPlanBlock {
  return {
    id: row.id,
    planId: row.planId,
    taskId: row.taskId,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    objective: row.objective,
    action: row.action,
    expectedOutput: row.expectedOutput,
    difficulty: row.difficulty,
    material: row.material,
    successCheck: row.successCheck,
    fallback: row.fallback,
    status: row.status,
    position: row.position
  };
}

function mapSession(row: typeof studySessions.$inferSelect): StudySession {
  return {
    id: row.id,
    blockId: row.blockId,
    taskId: row.taskId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
    focusScore: row.focusScore,
    notes: row.notes
  };
}
