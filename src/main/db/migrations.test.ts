import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from './client';
import { databaseMigrations, runDatabaseMigrations } from './migrations';

const tempPaths: string[] = [];

function tempDatabasePath(): string {
  const path = mkdtempSync(join(tmpdir(), 'study-migration-test-'));
  tempPaths.push(path);
  return path;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of tempPaths.splice(0)) {
    await removeTempDir(path);
  }
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

describe('database migration matrix', () => {
  it('全新空库建立当前 schema，并登记全部 migration 且无跳过日志', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const created = await createDatabase(tempDatabasePath());
    try {
      const applied = await created.client.execute('SELECT id FROM schema_migrations ORDER BY id');
      const foreignKeys = await created.client.execute('PRAGMA foreign_key_check');

      expect(applied.rows.map((row) => row.id)).toEqual(databaseMigrations.map(({ id }) => id).sort());
      expect(foreignKeys.rows).toHaveLength(0);
      expect(log).not.toHaveBeenCalled();
    } finally {
      created.client.close();
    }
  });

  it('已升级库重复启动保持幂等并保留正式数据', async () => {
    const path = tempDatabasePath();
    const first = await createDatabase(path);
    await first.client.execute({
      sql: `INSERT INTO goals (id, title, description, status, priority, created_at, updated_at)
            VALUES (?, ?, ?, 'active', 3, ?, ?)`,
      args: ['goal-preserved', '保留目标', '迁移重复启动测试', '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z']
    });
    first.client.close();

    const second = await createDatabase(path);
    try {
      const goal = await second.client.execute({ sql: 'SELECT title FROM goals WHERE id = ?', args: ['goal-preserved'] });
      const applied = await second.client.execute('SELECT id FROM schema_migrations');

      expect(goal.rows[0]?.title).toBe('保留目标');
      expect(applied.rows).toHaveLength(databaseMigrations.length);
    } finally {
      second.client.close();
    }
  });

  it('典型旧库补跑缺失 migration，不改已有用户记录', async () => {
    const path = tempDatabasePath();
    const old = await createDatabase(path);
    await old.client.execute({
      sql: `INSERT INTO goals (id, title, description, status, priority, created_at, updated_at)
            VALUES (?, ?, ?, 'active', 3, ?, ?)`,
      args: ['legacy-goal', '旧库目标', '升级测试', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z']
    });
    await old.client.execute('DROP TABLE knowledge_item_evidence');
    await old.client.execute({
      sql: 'DELETE FROM schema_migrations WHERE id = ?',
      args: ['202607100001_knowledge_item_evidence']
    });
    old.client.close();

    const upgraded = await createDatabase(path);
    try {
      const table = await upgraded.client.execute(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_item_evidence'`
      );
      const goal = await upgraded.client.execute({ sql: 'SELECT title FROM goals WHERE id = ?', args: ['legacy-goal'] });
      const foreignKeys = await upgraded.client.execute('PRAGMA foreign_key_check');

      expect(table.rows).toHaveLength(1);
      expect(goal.rows[0]?.title).toBe('旧库目标');
      expect(foreignKeys.rows).toHaveLength(0);
    } finally {
      upgraded.client.close();
    }
  });

  it('统一 Agent Loop 迁移可回滚并再次前向迁移，保留 AI 审计内容', async () => {
    const path = tempDatabasePath();
    const created = await createDatabase(path);
    const migration = databaseMigrations.find(({ id }) => id === '202607230001_unified_agent_loop');
    expect(migration?.rollbackSql).toBeTruthy();
    try {
      await created.client.execute(`
        INSERT INTO ai_reviews (
          id, kind, provider, model, input_snapshot_json, output_json,
          output_schema_version, status, record_type, conversation_scope,
          conversation_ref_id, started_at, created_at
        ) VALUES (
          'run-waiting', 'goal_intake', 'test', 'test', '{}', '{"reply":"请补充时间"}',
          'goal-intake.v1', 'waiting_user', 'run', 'goal_intake',
          'intake-1', '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z'
        )
      `);
      await created.client.execute(`
        INSERT INTO ai_reviews (
          id, kind, provider, model, input_snapshot_json, output_json,
          output_schema_version, status, record_type, parent_review_id,
          tool_name, tool_sequence, created_at
        ) VALUES (
          'tool-ask', 'tool_call', 'local', 'control', '{}', '{"question":"请补充时间"}',
          'ask-user.v1', 'waiting_user', 'tool_call', 'run-waiting',
          'ask_user', 1, '2026-07-23T00:00:00.000Z'
        )
      `);
      await created.client.execute(`
        INSERT INTO pending_interactions (
          id, run_review_id, tool_review_id, scope_type, scope_id, question,
          reason, answer_mode, options_json, can_skip, intent,
          expected_context_version, status, created_at
        ) VALUES (
          'pending-1', 'run-waiting', 'tool-ask', 'goal_intake', 'intake-1',
          '请补充时间', '缺少约束', 'free_text', '[]', 1,
          'continue_goal_intake', 2, 'open', '2026-07-23T00:00:00.000Z'
        )
      `);

      await created.client.executeMultiple(migration!.rollbackSql!);

      const pendingAfterRollback = await created.client.execute(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_interactions'`
      );
      const reviewsAfterRollback = await created.client.execute(
        `SELECT id, status, output_json FROM ai_reviews ORDER BY id`
      );
      const columnsAfterRollback = await created.client.execute(`PRAGMA table_info(ai_reviews)`);
      expect(pendingAfterRollback.rows).toHaveLength(0);
      expect(reviewsAfterRollback.rows).toHaveLength(2);
      expect(reviewsAfterRollback.rows.every((row) => row.status === 'failed')).toBe(true);
      expect(columnsAfterRollback.rows.some((row) => row.name === 'record_type')).toBe(false);

      await runDatabaseMigrations(created.client);

      const pendingAfterForward = await created.client.execute(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_interactions'`
      );
      const columnsAfterForward = await created.client.execute(`PRAGMA table_info(ai_reviews)`);
      const reviewsAfterForward = await created.client.execute(`SELECT id FROM ai_reviews`);
      expect(pendingAfterForward.rows).toHaveLength(1);
      expect(columnsAfterForward.rows.some((row) => row.name === 'record_type')).toBe(true);
      expect(reviewsAfterForward.rows).toHaveLength(2);
    } finally {
      created.client.close();
    }
  });
});
