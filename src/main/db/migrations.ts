import type { Client } from '@libsql/client';

export interface DatabaseMigration {
  id: string;
  sql: string;
}

export const databaseMigrations: DatabaseMigration[] = [
  {
    id: '202607020001_progressive_learning_runtime',
    sql: `
      CREATE TABLE IF NOT EXISTS plan_stages (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id),
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        prerequisites TEXT,
        success_criteria TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        position INTEGER NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_steps (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        stage_id TEXT REFERENCES plan_stages(id),
        task_id TEXT REFERENCES task_items(id),
        block_id TEXT REFERENCES daily_plan_blocks(id),
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        instruction TEXT NOT NULL,
        expected_output TEXT NOT NULL,
        success_criteria TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        attempt INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_runtime_states (
        id TEXT PRIMARY KEY,
        active_goal_id TEXT REFERENCES goals(id),
        active_stage_id TEXT REFERENCES plan_stages(id),
        active_daily_task_id TEXT REFERENCES daily_plan_blocks(id),
        active_step_id TEXT REFERENCES learning_steps(id),
        active_question_thread_id TEXT,
        session_status TEXT NOT NULL DEFAULT 'idle',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_threads (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        stage_id TEXT REFERENCES plan_stages(id),
        task_id TEXT REFERENCES task_items(id),
        step_id TEXT NOT NULL REFERENCES learning_steps(id),
        status TEXT NOT NULL DEFAULT 'open',
        question TEXT NOT NULL,
        resolution_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS question_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES question_threads(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_submissions (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL REFERENCES learning_steps(id),
        session_id TEXT REFERENCES study_sessions(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_evaluations (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES learning_submissions(id),
        step_id TEXT NOT NULL REFERENCES learning_steps(id),
        result TEXT NOT NULL,
        mastery INTEGER NOT NULL,
        evidence_json TEXT NOT NULL,
        correct_parts_json TEXT NOT NULL,
        misconceptions_json TEXT NOT NULL,
        missing_requirements_json TEXT NOT NULL,
        feedback TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        ai_review_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS next_step_decisions (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL REFERENCES learning_evaluations(id),
        step_id TEXT NOT NULL REFERENCES learning_steps(id),
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        task_completed INTEGER NOT NULL DEFAULT 0,
        next_step_json TEXT,
        remediation_json TEXT,
        carry_forward TEXT,
        ai_review_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_summaries (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS plan_stages_goal_position_idx
        ON plan_stages(goal_id, position);
      CREATE INDEX IF NOT EXISTS learning_steps_block_position_idx
        ON learning_steps(block_id, position);
      CREATE INDEX IF NOT EXISTS question_threads_step_status_idx
        ON question_threads(step_id, status);
      CREATE INDEX IF NOT EXISTS learning_summaries_kind_ref_idx
        ON learning_summaries(kind, ref_id);
    `
  },
  {
    id: '202607020002_plan_adjustment_proposals',
    sql: `
      CREATE TABLE IF NOT EXISTS plan_adjustment_proposals (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        stage_id TEXT REFERENCES plan_stages(id),
        task_id TEXT REFERENCES task_items(id),
        source_decision_id TEXT REFERENCES next_step_decisions(id),
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT NOT NULL,
        proposed_changes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE INDEX IF NOT EXISTS plan_adjustment_proposals_status_idx
        ON plan_adjustment_proposals(status, created_at);
    `
  },
  {
    id: '202607020003_plan_adjustment_application',
    sql: `
      ALTER TABLE plan_adjustment_proposals
        ADD COLUMN applied_task_id TEXT REFERENCES task_items(id);

      ALTER TABLE plan_adjustment_proposals
        ADD COLUMN applied_at TEXT;

      CREATE INDEX IF NOT EXISTS plan_adjustment_proposals_applied_task_idx
        ON plan_adjustment_proposals(applied_task_id);
    `
  },
  {
    id: '202607030004_goal_intake_layered_guides',
    sql: `
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

      CREATE INDEX IF NOT EXISTS goal_intake_messages_intake_created_idx
        ON goal_intake_messages(intake_id, created_at);
      CREATE INDEX IF NOT EXISTS roadmap_stages_goal_position_idx
        ON roadmap_stages(goal_id, position);
      CREATE INDEX IF NOT EXISTS short_plan_days_goal_day_idx
        ON short_plan_days(goal_id, day_index);
      CREATE INDEX IF NOT EXISTS daily_guides_goal_date_idx
        ON daily_guides(goal_id, date);
      CREATE INDEX IF NOT EXISTS daily_guide_blocks_guide_position_idx
        ON daily_guide_blocks(guide_id, position);
    `
  },
  {
    id: '202607040005_task_based_daily_guides',
    sql: `
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

      CREATE INDEX IF NOT EXISTS daily_guide_tasks_guide_position_idx
        ON daily_guide_tasks(guide_id, position);
      CREATE INDEX IF NOT EXISTS daily_guide_tasks_legacy_block_idx
        ON daily_guide_tasks(legacy_plan_block_id);
      CREATE INDEX IF NOT EXISTS daily_guide_actions_task_position_idx
        ON daily_guide_actions(task_id, position);
    `
  }
];

export async function runDatabaseMigrations(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

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
