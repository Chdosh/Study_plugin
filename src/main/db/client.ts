import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { bootstrapDatabase } from './bootstrap';
import * as schema from './schema';

export type Database = Awaited<ReturnType<typeof createDatabase>>['db'];
export type DatabaseClient = Awaited<ReturnType<typeof createDatabase>>['client'];

export async function createDatabase(userDataPath: string) {
  const dbPath = join(userDataPath, 'study-supervisor.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const client = createClient({ url: `file:${dbPath}` });
  await bootstrapDatabase(client);
  return {
    client,
    db: drizzle(client, { schema })
  };
}
