import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { databaseMigrations, runDatabaseMigrations } from './migrations';

const tempPaths: string[] = [];

describe('V2 database bootstrap', () => {
  afterEach(async () => {
    for (const path of tempPaths.splice(0)) await removeTempDir(path);
  });

  it('creates a clean V2 database without legacy tables', async () => {
    const created = await createDatabase(tempPath());
    try {
      const version = await created.client.execute(
        `SELECT value FROM app_settings WHERE key = 'schemaVersion'`
      );
      const legacy = await created.client.execute(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'task_items', 'daily_plans', 'daily_plan_blocks', 'daily_guide_blocks',
            'learning_steps', 'next_step_decisions', 'plan_adjustment_proposals'
          )
      `);
      const foreignKeys = await created.client.execute('PRAGMA foreign_key_check');
      expect(version.rows[0]?.value).toBe('study-v2');
      expect(legacy.rows).toHaveLength(0);
      expect(foreignKeys.rows).toHaveLength(0);
    } finally {
      created.client.close();
    }
  });

  it('keeps V2 bootstrap idempotent and preserves facts', async () => {
    const path = tempPath();
    const first = await createDatabase(path);
    await first.client.execute({
      sql: `INSERT INTO goals (
        id, title, description, status, priority, due_date, created_at, updated_at
      ) VALUES (?, ?, NULL, 'active', 3, NULL, ?, ?)`,
      args: ['goal-preserved', '保留目标', '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z']
    });
    first.client.close();

    const second = await createDatabase(path);
    try {
      const goal = await second.client.execute(
        `SELECT title FROM goals WHERE id = 'goal-preserved'`
      );
      expect(goal.rows[0]?.title).toBe('保留目标');
    } finally {
      second.client.close();
    }
  });

  it('requires rollback SQL for every future V2 migration', () => {
    for (const migration of databaseMigrations) {
      expect(migration.rollbackSql.trim().length).toBeGreaterThan(0);
    }
  });

  it('adds and rolls back the single Task closure reason field', async () => {
    const created = await createDatabase(tempPath());
    try {
      const migration = databaseMigrations.find((item) =>
        item.id === '2026-07-24-task-closure-reason'
      )!;
      let columns = await created.client.execute('PRAGMA table_info(learning_tasks)');
      expect(columns.rows.map((row) => row.name)).toContain('closure_reason');

      await created.client.executeMultiple(migration.rollbackSql);
      columns = await created.client.execute('PRAGMA table_info(learning_tasks)');
      expect(columns.rows.map((row) => row.name)).not.toContain('closure_reason');

      await runDatabaseMigrations(created.client);
      columns = await created.client.execute('PRAGMA table_info(learning_tasks)');
      expect(columns.rows.map((row) => row.name)).toContain('closure_reason');
    } finally {
      created.client.close();
    }
  });

  it('rolls back the Guide supplement columns explicitly', async () => {
    const created = await createDatabase(tempPath());
    try {
      const migration = databaseMigrations.find((item) =>
        item.id === '2026-07-24-learning-action-agent-supplement'
      )!;
      await created.client.executeMultiple(migration.rollbackSql);
      const columns = await created.client.execute('PRAGMA table_info(learning_actions)');
      const names = columns.rows.map((row) => row.name);
      expect(names).not.toContain('origin');
      expect(names).not.toContain('source_ai_review_id');

      await runDatabaseMigrations(created.client);
      const reappliedColumns = await created.client.execute('PRAGMA table_info(learning_actions)');
      const reappliedNames = reappliedColumns.rows.map((row) => row.name);
      expect(reappliedNames).toContain('origin');
      expect(reappliedNames).toContain('source_ai_review_id');
    } finally {
      created.client.close();
    }
  });

  it('migrates and rolls back Roadmap checkpoint dates without touching stages', async () => {
    const created = await createDatabase(tempPath());
    try {
      await created.client.execute({
        sql: `INSERT INTO goals (
          id, title, description, status, priority, due_date, created_at, updated_at
        ) VALUES (?, ?, NULL, 'active', 3, ?, ?, ?)`,
        args: [
          'goal-checkpoint',
          '一个月目标',
          '2026-08-24',
          '2026-07-24T00:00:00.000Z',
          '2026-07-24T00:00:00.000Z'
        ]
      });
      await created.client.execute({
        sql: `INSERT INTO roadmap_stages (
          id, goal_id, title, objective, direction, success_criteria,
          target_date, status, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
        args: [
          'stage-checkpoint',
          'goal-checkpoint',
          '基础',
          '完成基础',
          '从练习开始',
          '能独立完成练习',
          '2026-08-01',
          '2026-07-24T00:00:00.000Z',
          '2026-07-24T00:00:00.000Z'
        ]
      });
      const migration = databaseMigrations.find((item) =>
        item.id === '2026-07-24-roadmap-stage-target-date'
      )!;
      await created.client.executeMultiple(migration.rollbackSql);
      const afterRollback = await created.client.execute('PRAGMA table_info(roadmap_stages)');
      expect(afterRollback.rows.map((row) => row.name)).not.toContain('target_date');
      expect((await created.client.execute(
        `SELECT COUNT(*) AS count FROM roadmap_stages WHERE id = 'stage-checkpoint'`
      )).rows[0]?.count).toBe(1);

      await runDatabaseMigrations(created.client);
      const afterReapply = await created.client.execute('PRAGMA table_info(roadmap_stages)');
      expect(afterReapply.rows.map((row) => row.name)).toContain('target_date');
      expect((await created.client.execute(
        `SELECT target_date FROM roadmap_stages WHERE id = 'stage-checkpoint'`
      )).rows[0]?.target_date).toBeNull();
    } finally {
      created.client.close();
    }
  });

  it('migrates and rolls back append-only evaluation correction metadata', async () => {
    const created = await createDatabase(tempPath());
    try {
      const migration = databaseMigrations.find((item) =>
        item.id === '2026-07-24-evaluation-correction-metadata'
      )!;
      let columns = await created.client.execute('PRAGMA table_info(learning_evaluations)');
      expect(columns.rows.map((row) => row.name)).toEqual(expect.arrayContaining([
        'recommendation_decision_reason',
        'source',
        'supersedes_evaluation_id',
        'correction_reason'
      ]));

      await created.client.executeMultiple(migration.rollbackSql);
      columns = await created.client.execute('PRAGMA table_info(learning_evaluations)');
      expect(columns.rows.map((row) => row.name)).not.toContain('correction_reason');

      await runDatabaseMigrations(created.client);
      columns = await created.client.execute('PRAGMA table_info(learning_evaluations)');
      expect(columns.rows.map((row) => row.name)).toContain('correction_reason');
    } finally {
      created.client.close();
    }
  });

  it('refuses to open an unverified file as the formal V2 database', async () => {
    const path = tempPath();
    const raw = createClient({ url: `file:${join(path, 'study-supervisor-v2.db')}` });
    await raw.execute('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
    await raw.execute({
      sql: `INSERT INTO app_settings (key, value, updated_at) VALUES ('schemaVersion', 'unknown', ?)`,
      args: ['2026-07-23T00:00:00.000Z']
    });
    raw.close();

    await expect(createDatabase(path)).rejects.toThrow('Runtime 拒绝加载');
  });
});

function tempPath(): string {
  const path = mkdtempSync(join(tmpdir(), 'study-v2-db-test-'));
  tempPaths.push(path);
  return path;
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
