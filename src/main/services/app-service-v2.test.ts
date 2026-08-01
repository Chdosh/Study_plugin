import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type DatabaseClient } from '../db/client';
import {
  focusSessions,
  goals,
  learningActions,
  learningEvaluations,
  learningGuides,
  learningSubmissions,
  learningTasks
} from '../db/schema';
import { AppService } from './app-service';
import type { SettingsService } from './settings-service';
import { StudyStore } from './store';

describe('AppService V2 submission flow', () => {
  let root: string;
  let client: DatabaseClient;
  let db: Database;
  let appService: AppService;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'study-app-v2-'));
    const created = await createDatabase(root);
    client = created.client;
    db = created.db;
    const store = new StudyStore(db);
    await store.seedDefaults();
    appService = new AppService(store, createFakeSettingsService(), () => null);
    await insertLearningUnit(db);
  });

  afterEach(async () => {
    client.close();
    await removeTempDir(root);
  });

  it('submits, closes the Task and Session, then evaluates in the background', async () => {
    const session = await appService.startSession('task-1');
    await appService.completeCurrentAction('action-1');
    const beforeSubmission = await appService.getLearningState();
    expect(beforeSubmission.dailyGuideAction).toBeNull();

    const result = await appService.submitLearningResult('我完成了闭包说明和运行验证。');
    const submissions = await db.select().from(learningSubmissions);
    const evaluations = await waitForEvaluation(db);
    const task = (await db.select().from(learningTasks)
      .where(eq(learningTasks.id, 'task-1')))[0];
    const storedSession = (await db.select().from(focusSessions)
      .where(eq(focusSessions.id, session.id)))[0];

    expect(result.submission.stepId).toBeNull();
    expect(result.submission.taskId).toBe('task-1');
    expect(submissions[0]?.taskId).toBe('task-1');
    expect(evaluations).toHaveLength(1);
    expect(task.status).toBe('closed');
    expect(storedSession.status).toBe('ended');
  });
});

async function waitForEvaluation(db: Database): Promise<Array<typeof learningEvaluations.$inferSelect>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const evaluations = await db.select().from(learningEvaluations);
    if (evaluations.length > 0) return evaluations;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return db.select().from(learningEvaluations);
}

async function insertLearningUnit(db: Database): Promise<void> {
  const now = '2026-07-23T00:00:00.000Z';
  await db.insert(goals).values({
    id: 'goal-1',
    title: '掌握闭包',
    description: null,
    status: 'active',
    priority: 3,
    dueDate: null,
    createdAt: now,
    updatedAt: now
  });
  await db.insert(learningGuides).values({
    id: 'guide-1',
    goalId: 'goal-1',
    nearTermPlanItemId: null,
    suggestedDate: null,
    status: 'active',
    weekFocus: '闭包',
    learningGoal: '理解闭包',
    deliverablesJson: '["闭包说明"]',
    boundariesJson: '[]',
    acceptanceCriteriaJson: '["能够解释闭包"]',
    nextActionsJson: '[]',
    createdAt: now,
    confirmedAt: now
  });
  await db.insert(learningTasks).values({
    id: 'task-1',
    goalId: 'goal-1',
    guideId: 'guide-1',
    roadmapStageId: null,
    title: '解释闭包',
    objective: '能够解释闭包',
    scope: 'JavaScript 基础',
    estimatedMinMinutes: 10,
    estimatedTargetMinutes: 20,
    estimatedMaxMinutes: 30,
    deliverable: '闭包说明',
    doneWhenJson: '["包含例子"]',
    quickHint: '关注词法作用域',
    evaluationMode: 'local',
    difficulty: 'foundation',
    taskMode: 'learning',
    status: 'planned',
    closureKind: null,
    nextStartPoint: null,
    position: 0,
    createdAt: now,
    updatedAt: now
  });
  await db.insert(learningActions).values({
    id: 'action-1',
    taskId: 'task-1',
    title: '写出解释',
    instruction: '用自己的话解释',
    checkpoint: '包含词法作用域',
    requirement: 'required',
    status: 'planned',
    progressNote: null,
    completedAt: null,
    position: 0
  });
}

function createFakeSettingsService(): SettingsService {
  return {
    getRuntimeSettings: async () => ({
      aiBaseUrl: 'https://example.invalid',
      aiModel: 'fake-ai-model',
      aiApiKey: 'test-key',
      hasAiApiKey: true,
      autoLaunch: false,
      defaultBlockMinutes: 10,
      dailyStudyWindows: [{ start: '20:00', end: '22:00' }]
    })
  } as unknown as SettingsService;
}

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
