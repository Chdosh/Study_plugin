import type { Client } from '@libsql/client';

export interface DatabaseMigration {
  id: string;
  sql: string;
  rollbackSql: string;
}

// V1 -> V2 is a database replacement, not an in-place migration.
// Future V2 -> V2 migrations must be appended here with rollback SQL.
export const databaseMigrations: DatabaseMigration[] = [
  {
    id: '2026-07-24-learning-action-agent-supplement',
    sql: `
      ALTER TABLE learning_actions
        ADD COLUMN origin TEXT NOT NULL DEFAULT 'guide_generated'
        CHECK (origin IN ('guide_generated', 'agent_supplement'));
      ALTER TABLE learning_actions
        ADD COLUMN source_ai_review_id TEXT REFERENCES ai_reviews(id);
      CREATE UNIQUE INDEX learning_actions_source_ai_review_unique
        ON learning_actions(source_ai_review_id)
        WHERE source_ai_review_id IS NOT NULL;
    `,
    rollbackSql: `
      DROP INDEX IF EXISTS learning_actions_source_ai_review_unique;
      ALTER TABLE learning_actions DROP COLUMN source_ai_review_id;
      ALTER TABLE learning_actions DROP COLUMN origin;
      DELETE FROM schema_migrations
        WHERE id = '2026-07-24-learning-action-agent-supplement';
    `
  },
  {
    id: '2026-07-24-roadmap-stage-target-date',
    sql: `
      ALTER TABLE roadmap_stages
        ADD COLUMN target_date TEXT;
    `,
    rollbackSql: `
      ALTER TABLE roadmap_stages DROP COLUMN target_date;
      DELETE FROM schema_migrations
        WHERE id = '2026-07-24-roadmap-stage-target-date';
    `
  },
  {
    id: '2026-07-24-evaluation-correction-metadata',
    sql: `
      ALTER TABLE learning_evaluations
        ADD COLUMN recommendation_decision_reason TEXT;
      ALTER TABLE learning_evaluations
        ADD COLUMN source TEXT NOT NULL DEFAULT 'ai'
        CHECK (source IN ('ai', 'user_correction'));
      ALTER TABLE learning_evaluations
        ADD COLUMN supersedes_evaluation_id TEXT;
      ALTER TABLE learning_evaluations
        ADD COLUMN correction_reason TEXT;
      CREATE UNIQUE INDEX learning_evaluations_one_correction_per_parent
        ON learning_evaluations(supersedes_evaluation_id)
        WHERE supersedes_evaluation_id IS NOT NULL;
    `,
    rollbackSql: `
      DROP INDEX IF EXISTS learning_evaluations_one_correction_per_parent;
      ALTER TABLE learning_evaluations DROP COLUMN correction_reason;
      ALTER TABLE learning_evaluations DROP COLUMN supersedes_evaluation_id;
      ALTER TABLE learning_evaluations DROP COLUMN source;
      ALTER TABLE learning_evaluations DROP COLUMN recommendation_decision_reason;
      DELETE FROM schema_migrations
        WHERE id = '2026-07-24-evaluation-correction-metadata';
    `
  },
  {
    id: '2026-07-24-task-closure-reason',
    sql: `
      ALTER TABLE learning_tasks
        ADD COLUMN closure_reason TEXT;
    `,
    rollbackSql: `
      ALTER TABLE learning_tasks DROP COLUMN closure_reason;
      DELETE FROM schema_migrations
        WHERE id = '2026-07-24-task-closure-reason';
    `
  },
  {
    id: '2026-07-29-submission-step-evaluation-status',
    sql: `
      ALTER TABLE learning_submissions
        ADD COLUMN step_id TEXT REFERENCES learning_actions(id);
      ALTER TABLE learning_submissions
        ADD COLUMN evaluation_status TEXT NOT NULL DEFAULT 'waiting'
        CHECK (evaluation_status IN ('waiting', 'evaluating', 'completed', 'failed'));
      ALTER TABLE learning_submissions
        ADD COLUMN evaluation_attempt_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE learning_submissions
        ADD COLUMN last_evaluation_error TEXT;
      ALTER TABLE learning_submissions
        ADD COLUMN last_evaluation_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_learning_submissions_eval_status
        ON learning_submissions(evaluation_status)
        WHERE evaluation_status IN ('waiting', 'failed');
    `,
    rollbackSql: `
      DROP INDEX IF EXISTS idx_learning_submissions_eval_status;
      ALTER TABLE learning_submissions DROP COLUMN IF EXISTS last_evaluation_at;
      ALTER TABLE learning_submissions DROP COLUMN IF EXISTS last_evaluation_error;
      ALTER TABLE learning_submissions DROP COLUMN IF EXISTS evaluation_attempt_count;
      ALTER TABLE learning_submissions DROP COLUMN IF EXISTS evaluation_status;
      ALTER TABLE learning_submissions DROP COLUMN IF EXISTS step_id;
      DELETE FROM schema_migrations
        WHERE id = '2026-07-29-submission-step-evaluation-status';
    `
  },
  {
    id: '2026-08-04-goal-intake-questions',
    sql: `
      ALTER TABLE goal_intakes
        ADD COLUMN questions_json TEXT;
    `,
    rollbackSql: `
      ALTER TABLE goal_intakes DROP COLUMN questions_json;
      DELETE FROM schema_migrations
        WHERE id = '2026-08-04-goal-intake-questions';
    `
  }
];
  
async function ensureMigrationTable(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export async function runDatabaseMigrations(client: Client): Promise<void> {
  await ensureMigrationTable(client);
  for (const migration of databaseMigrations) {
    const existing = await client.execute({
      sql: 'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
      args: [migration.id]
    });
    if (existing.rows.length > 0) continue;
    await client.executeMultiple(migration.sql);
    await client.execute({
      sql: 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
      args: [migration.id, new Date().toISOString()]
    });
  }
}
