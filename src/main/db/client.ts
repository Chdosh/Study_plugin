import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  bootstrapDatabase,
  REQUIRED_V2_INDEXES,
  REQUIRED_V2_TABLES,
  V2_SCHEMA_VERSION
} from './bootstrap';
import * as schema from './schema';

export type Database = Awaited<ReturnType<typeof createDatabase>>['db'];
export type DatabaseClient = Awaited<ReturnType<typeof createDatabase>>['client'];

export async function createDatabase(userDataPath: string) {
  const dbPath = join(userDataPath, 'study-supervisor-v2.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const v2Exists = existsSync(dbPath);
  if (!v2Exists) {
    const legacyPath = join(userDataPath, 'study-supervisor.db');
    if (existsSync(legacyPath)) {
      throw new Error(
        '检测到 V1 数据库但尚未完成 V2 升级。请先运行独立 V1→V2 升级模块；Runtime 不会读取或自动迁移 V1。'
      );
    }
  }
  const client = createClient({ url: `file:${dbPath}` });
  try {
    if (v2Exists) {
      const placeholders = REQUIRED_V2_TABLES.map(() => '?').join(', ');
      const tables = await client.execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
        args: [...REQUIRED_V2_TABLES]
      });
      if (tables.rows.length !== REQUIRED_V2_TABLES.length) {
        throw new Error('V2 数据库结构不完整，Runtime 拒绝加载。请使用归档恢复或重新执行独立升级器。');
      }
      const indexPlaceholders = REQUIRED_V2_INDEXES.map(() => '?').join(', ');
      const indexes = await client.execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${indexPlaceholders})`,
        args: [...REQUIRED_V2_INDEXES]
      });
      if (indexes.rows.length !== REQUIRED_V2_INDEXES.length) {
        throw new Error('V2 数据库约束不完整，Runtime 拒绝加载。请使用归档恢复或重新执行独立升级器。');
      }
      const marker = await client.execute(`
        SELECT value FROM app_settings
        WHERE key = 'schemaVersion'
        LIMIT 1
      `);
      if (String(marker.rows[0]?.value ?? '') !== V2_SCHEMA_VERSION) {
        throw new Error('V2 数据库未通过版本识别，Runtime 拒绝加载。请使用归档恢复或重新执行独立升级器。');
      }
    }
    await bootstrapDatabase(client);
  } catch (error) {
    client.close();
    throw error;
  }
  return {
    client,
    db: drizzle(client, { schema })
  };
}
