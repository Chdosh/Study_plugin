import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../db/client';
import { StudyStore } from './store';

let tmpPath: string;
let client: DatabaseClient;
let store: StudyStore;

beforeEach(async () => {
  tmpPath = mkdtempSync(join(tmpdir(), 'study-supervisor-test-'));
  const created = await createDatabase(tmpPath);
  client = created.client;
  store = new StudyStore(created.db);
  await store.seedDefaults();
});

afterEach(async () => {
  client.close();
  await removeTempDir(tmpPath);
});

describe('StudyStore', () => {
  it('seeds editable prompt profiles', async () => {
    const prompts = await store.listPromptProfiles();

    expect(prompts.map((prompt) => prompt.key)).toContain('foundation');
    expect(prompts[0].version).toBeGreaterThan(0);
  });

  it('saves parsed imports as tasks', async () => {
    const rawImport = await store.createRawImport('Learn SQLite and Electron', 'manual');

    const tasks = await store.saveParsedImport(rawImport.id, {
      goals: [
        {
          title: 'Build app',
          description: 'Main goal',
          priority: 3,
          dueDate: null
        }
      ],
      tasks: [
        {
          title: 'Create schema',
          description: 'Define local tables',
          goalTitle: 'Build app',
          priority: 2,
          difficulty: 'foundation',
          estimateMinutes: 40,
          acceptanceCriteria: 'Schema can initialize',
          dependsOnTitles: []
        }
      ]
    });

    expect(tasks).toHaveLength(1);
    expect((await store.listTasks())[0].title).toBe('Create schema');
  });

  it('creates draft plans from validated agent output', async () => {
    const plan = await store.createPlanFromAgentOutput({
      date: '2026-06-19',
      availableWindowsJson: JSON.stringify([{ start: '20:00', end: '21:00' }]),
      output: {
        blocks: [
          {
            taskTitle: null,
            startTime: '20:00',
            endTime: '20:10',
            durationMinutes: 10,
            objective: 'Open materials',
            action: 'Prepare study context',
            expectedOutput: 'Workspace ready',
            difficulty: 'foundation',
            material: 'Local plan',
            successCheck: 'Ready to study',
            fallback: 'Reduce setup to one file'
          }
        ]
      }
    });

    expect(plan.status).toBe('draft');
    expect(plan.blocks).toHaveLength(1);
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
