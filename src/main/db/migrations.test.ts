import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from './client';
import { databaseMigrations } from './migrations';

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
});
