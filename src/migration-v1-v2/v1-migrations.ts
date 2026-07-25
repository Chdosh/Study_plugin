// Historical V1 migrations are retained only by the isolated upgrader.
import type { Client } from '@libsql/client';

export interface DatabaseMigration {
  id: string;
  sql: string;
  rollbackSql?: string;
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
  },
  {
    id: '202607050006_short_plan_day_association',
    sql: `
      ALTER TABLE daily_plans ADD COLUMN short_plan_day_id TEXT REFERENCES short_plan_days(id);
      ALTER TABLE daily_guides ADD COLUMN short_plan_day_id TEXT REFERENCES short_plan_days(id);
      CREATE UNIQUE INDEX IF NOT EXISTS short_plan_days_goal_date_not_null_idx
        ON short_plan_days(goal_id, date) WHERE date IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS daily_guides_short_plan_day_unique
        ON daily_guides(short_plan_day_id);
    `
  },
  {
    id: '202607050007_runtime_convergence',
    sql: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS _migration_backup_runtime AS SELECT * FROM learning_runtime_states;
      CREATE TABLE IF NOT EXISTS _migration_backup_sessions AS SELECT * FROM study_sessions;

      CREATE TABLE learning_runtime_states_new (
        id TEXT PRIMARY KEY,
        active_goal_id TEXT REFERENCES goals(id),
        active_stage_id TEXT REFERENCES roadmap_stages(id),
        active_daily_task_id TEXT REFERENCES daily_guide_tasks(id),
        active_step_id TEXT REFERENCES daily_guide_actions(id),
        active_question_thread_id TEXT,
        session_status TEXT NOT NULL DEFAULT 'idle' CHECK(session_status IN ('idle','active','paused','completed')),
        updated_at TEXT NOT NULL
      );

      INSERT INTO learning_runtime_states_new
      SELECT
        r.id,
        r.active_goal_id,
        NULL AS active_stage_id,
        (SELECT dgt.id FROM daily_guide_tasks dgt
         WHERE dgt.legacy_plan_block_id = r.active_daily_task_id LIMIT 1) AS active_daily_task_id,
        NULL AS active_step_id,
        r.active_question_thread_id,
        r.session_status,
        r.updated_at
      FROM learning_runtime_states r;

      CREATE TABLE study_sessions_new (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES daily_guide_tasks(id),
        task_items_id TEXT REFERENCES task_items(id),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_minutes INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','skipped')),
        focus_score INTEGER,
        notes TEXT
      );

      INSERT INTO study_sessions_new
      SELECT
        s.id,
        CASE
          WHEN s.status IN ('active','paused') AND (
            SELECT dgt.id FROM daily_guide_tasks dgt WHERE dgt.legacy_plan_block_id = s.block_id LIMIT 1
          ) IS NULL THEN NULL
          ELSE (SELECT dgt.id FROM daily_guide_tasks dgt WHERE dgt.legacy_plan_block_id = s.block_id LIMIT 1)
        END AS task_id,
        s.task_id AS task_items_id,
        s.started_at,
        s.ended_at,
        s.duration_minutes,
        CASE
          WHEN s.status IN ('active','paused') AND (
            SELECT dgt.id FROM daily_guide_tasks dgt WHERE dgt.legacy_plan_block_id = s.block_id LIMIT 1
          ) IS NULL THEN 'completed'
          ELSE s.status
        END AS status,
        s.focus_score,
        s.notes
      FROM study_sessions s;

      DROP TABLE learning_runtime_states;
      ALTER TABLE learning_runtime_states_new RENAME TO learning_runtime_states;

      DROP TABLE study_sessions;
      ALTER TABLE study_sessions_new RENAME TO study_sessions;

      UPDATE learning_runtime_states
      SET active_step_id = (
        SELECT dgt.current_action_id FROM daily_guide_tasks dgt
        WHERE dgt.id = learning_runtime_states.active_daily_task_id
        AND dgt.current_action_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM daily_guide_actions dga
          WHERE dga.id = dgt.current_action_id AND dga.task_id = dgt.id
        )
      )
      WHERE active_daily_task_id IS NOT NULL AND active_step_id IS NULL;

      UPDATE learning_runtime_states
      SET active_stage_id = (
        SELECT rs.id FROM roadmap_stages rs
        WHERE rs.goal_id = learning_runtime_states.active_goal_id
        ORDER BY rs.position ASC LIMIT 1
      )
      WHERE active_goal_id IS NOT NULL AND active_stage_id IS NULL;

      PRAGMA foreign_keys = ON;
      PRAGMA foreign_key_check;
    `
  },
  {
    id: '202607050008_daily_guide_action_fks',
    sql: `
      ALTER TABLE learning_submissions ADD COLUMN daily_guide_action_id TEXT REFERENCES daily_guide_actions(id);
      ALTER TABLE learning_evaluations ADD COLUMN daily_guide_action_id TEXT REFERENCES daily_guide_actions(id);
      CREATE TABLE learning_submissions_new (
        id TEXT PRIMARY KEY,
        step_id TEXT REFERENCES learning_steps(id),
        daily_guide_action_id TEXT REFERENCES daily_guide_actions(id),
        session_id TEXT REFERENCES study_sessions(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO learning_submissions_new SELECT id, step_id, NULL, session_id, content, created_at FROM learning_submissions;
      DROP TABLE learning_submissions;
      ALTER TABLE learning_submissions_new RENAME TO learning_submissions;
      CREATE TABLE learning_evaluations_new (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES learning_submissions(id),
        step_id TEXT REFERENCES learning_steps(id),
        daily_guide_action_id TEXT REFERENCES daily_guide_actions(id),
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
      INSERT INTO learning_evaluations_new SELECT id, submission_id, step_id, NULL, result, mastery, evidence_json, correct_parts_json, misconceptions_json, missing_requirements_json, feedback, recommended_action, ai_review_id, created_at FROM learning_evaluations;
      DROP TABLE learning_evaluations;
      ALTER TABLE learning_evaluations_new RENAME TO learning_evaluations;
      CREATE TABLE next_step_decisions_new (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL REFERENCES learning_evaluations(id),
        step_id TEXT REFERENCES learning_steps(id),
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        task_completed INTEGER NOT NULL DEFAULT 0,
        next_step_json TEXT,
        remediation_json TEXT,
        carry_forward TEXT,
        ai_review_id TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO next_step_decisions_new SELECT id, evaluation_id, step_id, decision, reason, task_completed, next_step_json, remediation_json, carry_forward, ai_review_id, created_at FROM next_step_decisions;
      DROP TABLE next_step_decisions;
      ALTER TABLE next_step_decisions_new RENAME TO next_step_decisions;
    `
  },
  {
    id: '202607050009_question_thread_action_fk',
    sql: `
      PRAGMA foreign_keys = OFF;
      CREATE TABLE question_threads_v2 (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        stage_id TEXT REFERENCES plan_stages(id),
        task_id TEXT REFERENCES task_items(id),
        step_id TEXT REFERENCES learning_steps(id),
        daily_guide_action_id TEXT REFERENCES daily_guide_actions(id),
        status TEXT NOT NULL DEFAULT 'open',
        question TEXT NOT NULL,
        resolution_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      );
      INSERT INTO question_threads_v2 SELECT id, goal_id, stage_id, task_id, step_id, NULL, status, question, resolution_summary, created_at, updated_at, resolved_at FROM question_threads;
      DROP TABLE question_threads;
      ALTER TABLE question_threads_v2 RENAME TO question_threads;
      PRAGMA foreign_keys = ON;
    `
  },
  {
    id: '202607060001_ai_reviews_observability',
    sql: `
      ALTER TABLE ai_reviews ADD COLUMN input_tokens INTEGER;
      ALTER TABLE ai_reviews ADD COLUMN output_tokens INTEGER;
      ALTER TABLE ai_reviews ADD COLUMN latency_ms INTEGER;
      ALTER TABLE ai_reviews ADD COLUMN error_category TEXT;
      ALTER TABLE ai_reviews ADD COLUMN trace_id TEXT;
    `
  },
  {
    id: '202607060002_learning_submissions_eval_status',
    sql: `
      ALTER TABLE learning_submissions ADD COLUMN evaluation_status TEXT NOT NULL DEFAULT 'completed';
    `
  },
  {
    id: '202607060003_generation_locks',
    sql: `
      CREATE TABLE IF NOT EXISTS generation_locks (
        lock_key TEXT PRIMARY KEY,
        locked_at TEXT NOT NULL
      );
    `
  },
  {
    id: '202607060004_session_status',
    sql: `
      ALTER TABLE daily_guides ADD COLUMN session_status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE short_plan_days ADD COLUMN session_status TEXT NOT NULL DEFAULT 'pending';
    `
  },
  {
    id: '202607060005_drop_short_plan_date_unique',
    sql: `DROP INDEX IF EXISTS short_plan_days_goal_date_not_null_idx;`
  },
  {
    id: '202607060006_roadmap_stage_status',
    sql: `
      ALTER TABLE roadmap_stages ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE daily_guide_tasks ADD COLUMN roadmap_stage_id TEXT REFERENCES roadmap_stages(id);
    `
  },
  {
    id: '202607060007_evaluation_decision',
    sql: `ALTER TABLE learning_evaluations ADD COLUMN decision TEXT NOT NULL DEFAULT 'stay';`
  },
  {
    id: '202607060008_short_plan_roadmap_stage',
    sql: `ALTER TABLE short_plan_days ADD COLUMN roadmap_stage_id TEXT REFERENCES roadmap_stages(id);`
  },
  {
    id: '202607060009_knowledge_items',
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        key TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    id: '202607060010_short_plan_locked',
    sql: `ALTER TABLE short_plan_days ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;`
  },
  {
    id: '202607110002_learner_facts',
    sql: `
      CREATE TABLE IF NOT EXISTS learner_facts (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        scope TEXT NOT NULL DEFAULT 'goal',
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS learner_facts_goal_scope_key_idx
        ON learner_facts(goal_id, scope, key);
    `
  },
  {
    id: '202607100001_knowledge_item_evidence',
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_item_evidence (
        id TEXT PRIMARY KEY,
        knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id),
        source_type TEXT NOT NULL,
        source_id TEXT,
        submission_id TEXT REFERENCES learning_submissions(id),
        evaluation_id TEXT REFERENCES learning_evaluations(id),
        task_id TEXT REFERENCES daily_guide_tasks(id),
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS knowledge_item_evidence_evaluation_unique
        ON knowledge_item_evidence(knowledge_item_id, evaluation_id);
    `
  },
  {
    id: '202607110003_question_thread_kind',
    sql: `ALTER TABLE question_threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'question';`
  },
  {
    id: '202607110004_question_thread_metadata',
    sql: `ALTER TABLE question_threads ADD COLUMN metadata TEXT;`
  },
  {
    id: '202607120001_learner_fact_task_anchor',
    sql: `
      ALTER TABLE learner_facts ADD COLUMN task_id TEXT REFERENCES daily_guide_tasks(id);
      UPDATE learner_facts SET goal_id = NULL WHERE scope = 'global';
    `
  },
  {
    id: '202607120002_submission_application_lifecycle',
    sql: `
      ALTER TABLE learning_submissions ADD COLUMN application_status TEXT NOT NULL DEFAULT 'applied';
      ALTER TABLE learning_submissions ADD COLUMN application_error TEXT;
      ALTER TABLE learning_submissions ADD COLUMN applied_at TEXT;
    `
  },
  {
    id: '202607230001_unified_agent_loop',
    sql: `
      ALTER TABLE ai_reviews ADD COLUMN record_type TEXT NOT NULL DEFAULT 'legacy_call';
      ALTER TABLE ai_reviews ADD COLUMN parent_review_id TEXT REFERENCES ai_reviews(id);
      ALTER TABLE ai_reviews ADD COLUMN tool_name TEXT;
      ALTER TABLE ai_reviews ADD COLUMN tool_sequence INTEGER;
      ALTER TABLE ai_reviews ADD COLUMN idempotency_key TEXT;
      ALTER TABLE ai_reviews ADD COLUMN goal_id TEXT REFERENCES goals(id);
      ALTER TABLE ai_reviews ADD COLUMN conversation_scope TEXT;
      ALTER TABLE ai_reviews ADD COLUMN conversation_ref_id TEXT;
      ALTER TABLE ai_reviews ADD COLUMN message_ref_id TEXT;
      ALTER TABLE ai_reviews ADD COLUMN context_version INTEGER;
      ALTER TABLE ai_reviews ADD COLUMN started_at TEXT;
      ALTER TABLE ai_reviews ADD COLUMN completed_at TEXT;

      CREATE TABLE pending_interactions (
        id TEXT PRIMARY KEY,
        run_review_id TEXT NOT NULL REFERENCES ai_reviews(id),
        tool_review_id TEXT NOT NULL REFERENCES ai_reviews(id),
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        question TEXT NOT NULL,
        reason TEXT NOT NULL,
        answer_mode TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        can_skip INTEGER NOT NULL DEFAULT 0,
        intent TEXT NOT NULL,
        expected_context_version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        answer_text TEXT,
        answer_message_ref_id TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE INDEX ai_reviews_parent_tool_idx
        ON ai_reviews(parent_review_id, tool_sequence);
      CREATE UNIQUE INDEX ai_reviews_idempotency_unique
        ON ai_reviews(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX ai_reviews_scope_status_idx
        ON ai_reviews(conversation_scope, conversation_ref_id, status);
      CREATE UNIQUE INDEX ai_reviews_one_active_run_per_scope
        ON ai_reviews(conversation_scope, conversation_ref_id)
        WHERE record_type = 'run' AND status IN ('running', 'waiting_user');
      CREATE UNIQUE INDEX pending_interactions_one_open_per_run
        ON pending_interactions(run_review_id) WHERE status = 'open';
      CREATE INDEX pending_interactions_scope_status_idx
        ON pending_interactions(scope_type, scope_id, status);
    `,
    rollbackSql: `
      PRAGMA foreign_keys = OFF;
      BEGIN;

      DROP TABLE IF EXISTS pending_interactions;
      DROP INDEX IF EXISTS ai_reviews_parent_tool_idx;
      DROP INDEX IF EXISTS ai_reviews_idempotency_unique;
      DROP INDEX IF EXISTS ai_reviews_scope_status_idx;
      DROP INDEX IF EXISTS ai_reviews_one_active_run_per_scope;

      CREATE TABLE ai_reviews_rollback (
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
        input_tokens INTEGER,
        output_tokens INTEGER,
        latency_ms INTEGER,
        error_category TEXT,
        trace_id TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO ai_reviews_rollback (
        id, kind, date, provider, model, prompt_profile_id, prompt_version_id,
        input_snapshot_json, output_json, output_schema_version, status,
        error_message, input_tokens, output_tokens, latency_ms, error_category,
        trace_id, created_at
      )
      SELECT
        id, kind, date, provider, model, prompt_profile_id, prompt_version_id,
        input_snapshot_json, output_json, output_schema_version,
        CASE WHEN status IN ('success', 'completed') THEN 'success' ELSE 'failed' END,
        CASE
          WHEN status IN ('running', 'waiting_user', 'cancelled')
            THEN COALESCE(error_message, 'Unified Agent Loop rollback cancelled this unfinished run.')
          ELSE error_message
        END,
        input_tokens, output_tokens, latency_ms, error_category, trace_id, created_at
      FROM ai_reviews;

      DROP TABLE ai_reviews;
      ALTER TABLE ai_reviews_rollback RENAME TO ai_reviews;
      DELETE FROM schema_migrations WHERE id = '202607230001_unified_agent_loop';

      COMMIT;
      PRAGMA foreign_keys = ON;
      PRAGMA foreign_key_check;
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

const bootstrapCoveredMigrationIds = new Set([
  '202607050006_short_plan_day_association',
  '202607060001_ai_reviews_observability',
  '202607060004_session_status',
  '202607060006_roadmap_stage_status',
  '202607060008_short_plan_roadmap_stage',
  '202607060010_short_plan_locked',
  '202607120001_learner_fact_task_anchor',
  '202607230001_unified_agent_loop'
]);

export async function markBootstrapCoveredMigrationsApplied(client: Client): Promise<void> {
  await ensureMigrationTable(client);
  const appliedAt = new Date().toISOString();
  for (const migration of databaseMigrations.filter(({ id }) => bootstrapCoveredMigrationIds.has(id))) {
    await client.execute({
      sql: 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)',
      args: [migration.id, appliedAt]
    });
  }
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
