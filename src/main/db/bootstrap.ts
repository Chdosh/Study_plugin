import type { Client } from '@libsql/client';
import { runDatabaseMigrations } from './migrations';

export async function bootstrapDatabase(client: Client): Promise<void> {
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS raw_imports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TEXT NOT NULL,
      parsed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      source_import_id TEXT REFERENCES raw_imports(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      priority INTEGER NOT NULL DEFAULT 3,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goal_intakes (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'collecting',
      goal_id TEXT REFERENCES goals(id),
      brief_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS goal_intake_messages (
      id TEXT PRIMARY KEY,
      intake_id TEXT NOT NULL REFERENCES goal_intakes(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadmap_stages (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id),
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      direction TEXT NOT NULL,
      success_criteria TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS short_plan_days (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id),
      day_index INTEGER NOT NULL,
      date TEXT,
      title TEXT NOT NULL,
      focus TEXT NOT NULL,
      tasks_json TEXT NOT NULL,
      expected_output TEXT NOT NULL,
      success_criteria TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_items (
      id TEXT PRIMARY KEY,
      goal_id TEXT REFERENCES goals(id),
      source_import_id TEXT REFERENCES raw_imports(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 3,
      difficulty TEXT NOT NULL DEFAULT 'foundation',
      estimate_minutes INTEGER NOT NULL DEFAULT 30,
      acceptance_criteria TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task_items(id),
      depends_on_task_id TEXT NOT NULL REFERENCES task_items(id),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS task_dependencies_unique
      ON task_dependencies(task_id, depends_on_task_id);

    CREATE TABLE IF NOT EXISTS daily_plans (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      available_windows_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      source_review_id TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS daily_plan_blocks (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES daily_plans(id),
      task_id TEXT REFERENCES task_items(id),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      objective TEXT NOT NULL,
      action TEXT NOT NULL,
      expected_output TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      material TEXT NOT NULL,
      success_check TEXT NOT NULL,
      fallback TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_guides (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id),
      plan_id TEXT NOT NULL REFERENCES daily_plans(id),
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      week_focus TEXT NOT NULL DEFAULT '',
      today_goal TEXT NOT NULL,
      deliverables_json TEXT NOT NULL,
      boundaries_json TEXT NOT NULL,
      acceptance_criteria_json TEXT NOT NULL,
      tomorrow_actions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_guide_blocks (
      id TEXT PRIMARY KEY,
      guide_id TEXT NOT NULL REFERENCES daily_guides(id),
      plan_block_id TEXT NOT NULL REFERENCES daily_plan_blocks(id),
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_guide_tasks (
      id TEXT PRIMARY KEY,
      guide_id TEXT NOT NULL REFERENCES daily_guides(id),
      legacy_plan_block_id TEXT REFERENCES daily_plan_blocks(id),
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      scope TEXT NOT NULL,
      estimated_min_minutes INTEGER NOT NULL,
      estimated_target_minutes INTEGER NOT NULL,
      estimated_max_minutes INTEGER NOT NULL,
      deliverable TEXT NOT NULL,
      done_when_json TEXT NOT NULL,
      quick_hint TEXT NOT NULL,
      evaluation_mode TEXT NOT NULL DEFAULT 'ai',
      submission_policy TEXT NOT NULL DEFAULT 'once_after_task',
      carryover_allowed INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'planned',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      current_action_id TEXT,
      next_start_point TEXT,
      total_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_guide_actions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES daily_guide_tasks(id),
      title TEXT NOT NULL,
      instruction TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      progress_note TEXT,
      completed_at TEXT,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY,
      block_id TEXT REFERENCES daily_plan_blocks(id),
      task_id TEXT REFERENCES task_items(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      focus_score INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS focus_events (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES study_sessions(id),
      app_name TEXT NOT NULL,
      window_title TEXT,
      event_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER
    );

    CREATE TABLE IF NOT EXISTS skip_logs (
      id TEXT PRIMARY KEY,
      block_id TEXT REFERENCES daily_plan_blocks(id),
      task_id TEXT REFERENCES task_items(id),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_reviews (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      date TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_profile_id TEXT,
      prompt_version_id TEXT,
      input_snapshot_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      output_schema_version TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_profiles (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      active_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES prompt_profiles(id),
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_versions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES daily_plans(id),
      version INTEGER NOT NULL,
      change_summary TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await runDatabaseMigrations(client);
}
