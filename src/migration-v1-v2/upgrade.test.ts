import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapDatabase as bootstrapV1 } from './v1-bootstrap';
import { upgradeV1ToV2 } from './upgrade';

const tempPaths: string[] = [];

describe('isolated V1 to V2 upgrader', () => {
  afterEach(async () => {
    for (const path of tempPaths.splice(0)) await removeTempDir(path);
  });

  it('archives V1, migrates only mapped facts, validates, and switches atomically', async () => {
    const root = tempPath();
    const v1Path = join(root, 'study-supervisor.db');
    const v2Path = join(root, 'study-supervisor-v2.db');
    const v1 = createClient({ url: `file:${v1Path}` });
    await bootstrapV1(v1);
    const now = '2026-07-23T00:00:00.000Z';
    await v1.execute({
      sql: `INSERT INTO goals (
        id, source_import_id, title, description, status, priority, due_date, created_at, updated_at
      ) VALUES (?, NULL, ?, NULL, 'active', 3, NULL, ?, ?)`,
      args: ['goal-1', '迁移目标', now, now]
    });
    await v1.execute({
      sql: `INSERT INTO task_items (
        id, goal_id, source_import_id, title, description, status, priority,
        difficulty, estimate_minutes, acceptance_criteria, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, 'in_progress', 3, 'exam', 30, ?, ?, ?)`,
      args: ['task-1', 'goal-1', '临时考核', '验证掌握情况', '能够完成考核', now, now]
    });
    await v1.execute({
      sql: `INSERT INTO question_threads (
        id, goal_id, stage_id, task_id, step_id, daily_guide_action_id,
        status, kind, metadata, question, resolution_summary, created_at, updated_at, resolved_at
      ) VALUES (?, NULL, NULL, ?, NULL, NULL, 'open', 'question', NULL, ?, NULL, ?, ?, NULL)`,
      args: ['thread-1', 'task-1', '如何继续？', now, now]
    });
    await v1.execute({
      sql: `INSERT INTO question_messages (id, thread_id, role, content, created_at)
        VALUES (?, ?, 'user', ?, ?), (?, ?, 'assistant', '', ?)`,
      args: ['message-1', 'thread-1', '保留这条原文', now, 'message-empty', 'thread-1', now]
    });
    v1.close();

    const result = await upgradeV1ToV2({ v1Path, v2Path });
    expect(result.status).toBe('completed');
    expect(existsSync(join(root, 'study-supervisor-v1-archive.db'))).toBe(true);
    expect(existsSync(v2Path)).toBe(true);

    const v2 = createClient({ url: `file:${v2Path}` });
    try {
      const task = await v2.execute(`SELECT goal_id, status, difficulty, task_mode FROM learning_tasks WHERE id = 'task-1'`);
      const legacy = await v2.execute(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('task_items', 'next_step_decisions', 'plan_adjustment_proposals')
      `);
      const integrity = await v2.execute('PRAGMA integrity_check');
      const thread = await v2.execute(`
        SELECT is_partial FROM conversation_threads WHERE id = 'thread-1'
      `);
      const messages = await v2.execute(`
        SELECT linked_goal_id, linked_task_id, linked_action_id, content
        FROM conversation_messages WHERE thread_id = 'thread-1'
      `);
      expect(task.rows[0]).toMatchObject({
        goal_id: 'goal-1',
        status: 'active',
        difficulty: null,
        task_mode: 'exam'
      });
      expect(legacy.rows).toHaveLength(0);
      expect(integrity.rows[0]?.integrity_check).toBe('ok');
      expect(thread.rows[0]?.is_partial).toBe(1);
      expect(messages.rows).toHaveLength(1);
      expect(messages.rows[0]).toMatchObject({
        linked_goal_id: 'goal-1',
        linked_task_id: 'task-1',
        linked_action_id: null,
        content: '保留这条原文'
      });
    } finally {
      v2.close();
    }

    const repeated = await upgradeV1ToV2({ v1Path, v2Path });
    expect(repeated).toMatchObject({ status: 'not_needed', v2Path });
  }, 15_000);
});

function tempPath(): string {
  const path = mkdtempSync(join(tmpdir(), 'study-v1-v2-test-'));
  tempPaths.push(path);
  return path;
}

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 7) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
