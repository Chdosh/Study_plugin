import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../db/client';
import type { Database } from '../../db/client';
import { LearnerContextModule } from './context';
import { StudyStore } from '../../services/store';

let tmpPath: string;
let client: DatabaseClient;
let store: StudyStore;
let module: LearnerContextModule;

beforeEach(async () => {
  tmpPath = mkdtempSync(join(tmpdir(), 'study-context-test-'));
  const created = await createDatabase(tmpPath);
  client = created.client;
  store = new StudyStore(created.db);
  await store.seedDefaults();
  module = new LearnerContextModule(store);
});

afterEach(async () => {
  client.close();
  await removeTempDir(tmpPath);
});

describe('LearnerContextModule', () => {
  it('proposeFact creates and retrieves a fact', async () => {
    const goal = await store.createGoal('测试目标');
    const fact = await module.proposeFact(goal.id, { scope: 'goal', key: 'os', value: 'Windows', source: 'user_stated' });
    expect(fact.value).toBe('Windows');

    const found = await module.getFact(goal.id, 'os', 'goal');
    expect(found).not.toBeNull();
    expect(found?.value).toBe('Windows');
  });

  it('confirmFact sets source to confirmed and preserves value', async () => {
    const goal = await store.createGoal('测试目标2');
    await module.proposeFact(goal.id, { scope: 'goal', key: 'pref', value: 'code_examples', source: 'inferred' });

    const confirmed = await module.confirmFact(goal.id, 'pref', 'goal');
    expect(confirmed.source).toBe('confirmed');
    expect(confirmed.value).toBe('code_examples');
  });

  it('confirmFact rejects a non-existing fact instead of creating an empty durable fact', async () => {
    const goal = await store.createGoal('测试目标2b');
    await expect(module.confirmFact(goal.id, 'nonexistent', 'goal')).rejects.toThrow('无法确认');
    expect(await module.getFact(goal.id, 'nonexistent', 'goal')).toBeNull();
  });

  it('an inferred proposal cannot overwrite an already confirmed fact', async () => {
    const goal = await store.createGoal('测试目标2c');
    await module.proposeFact(goal.id, { scope: 'goal', key: 'os', value: 'Windows', source: 'confirmed', confidence: 1 });

    const result = await module.proposeFact(goal.id, { scope: 'goal', key: 'os', value: 'Linux', source: 'inferred', confidence: 0.9 });

    expect(result.value).toBe('Windows');
    expect(result.source).toBe('confirmed');
  });

  it('listFactsForGoal returns all facts for a goal', async () => {
    const goal = await store.createGoal('测试目标3');
    await module.proposeFact(goal.id, { scope: 'goal', key: 'a', value: '1', source: 'user_stated' });
    await module.proposeFact(goal.id, { scope: 'global', key: 'b', value: '2', source: 'inferred' });

    const all = await module.listFactsForGoal(goal.id);
    expect(all.length).toBe(2);

    const scoped = await module.listFactsForGoal(goal.id, 'global');
    expect(scoped.length).toBe(1);
    expect(scoped[0].key).toBe('b');
  });

  it('shares global facts across goals while keeping goal facts isolated', async () => {
    const firstGoal = await store.createGoal('目标 A');
    const secondGoal = await store.createGoal('目标 B');
    await module.proposeFact(firstGoal.id, { scope: 'global', key: 'os', value: 'Windows', source: 'confirmed' });
    await module.proposeFact(firstGoal.id, { scope: 'goal', key: 'provider', value: 'DeepSeek', source: 'confirmed' });

    const secondGoalFacts = await module.listFactsForGoal(secondGoal.id);

    expect(secondGoalFacts).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'os', value: 'Windows', goalId: null })]));
    expect(secondGoalFacts.some((fact) => fact.key === 'provider')).toBe(false);
  });

  it('rejects task facts that do not identify their task anchor', async () => {
    const goal = await store.createGoal('目标 C');
    await expect(module.proposeFact(goal.id, { scope: 'task', key: 'format', value: '临时只输出命令', source: 'confirmed' }))
      .rejects.toThrow('必须绑定具体主任务');
  });

  it('deleteFact removes a fact', async () => {
    const goal = await store.createGoal('测试目标4');
    await module.proposeFact(goal.id, { scope: 'goal', key: 'temp', value: 'x', source: 'inferred' });

    let facts = await module.listFactsForGoal(goal.id);
    expect(facts.length).toBe(1);

    await module.deleteFact(goal.id, 'temp', 'goal');

    facts = await module.listFactsForGoal(goal.id);
    expect(facts.length).toBe(0);
  });
});

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
