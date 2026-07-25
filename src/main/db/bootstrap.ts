import type { Client } from '@libsql/client';
import { runDatabaseMigrations } from './migrations';

export const V2_SCHEMA_VERSION = 'study-v2';
export const REQUIRED_V2_TABLES = [
  'schema_migrations',
  'app_settings',
  'goals',
  'goal_intakes',
  'goal_intake_messages',
  'roadmap_stages',
  'near_term_plan_items',
  'plan_versions',
  'learning_guides',
  'learning_tasks',
  'learning_actions',
  'focus_sessions',
  'current_learning_context',
  'conversation_threads',
  'conversation_messages',
  'learning_submissions',
  'prompt_profiles',
  'prompt_versions',
  'ai_reviews',
  'learning_evaluations',
  'knowledge_items',
  'learner_facts',
  'knowledge_item_evidence',
  'pending_interactions'
] as const;
export const REQUIRED_V2_INDEXES = [
  'learning_guides_near_term_item_unique',
  'learning_tasks_guide_position_idx',
  'learning_actions_task_position_idx',
  'learning_actions_source_ai_review_unique',
  'focus_sessions_single_unfinished',
  'ai_reviews_parent_tool_idx',
  'ai_reviews_idempotency_unique',
  'ai_reviews_one_active_run_per_scope',
  'knowledge_item_evidence_evaluation_unique',
  'pending_interactions_one_open_per_run'
] as const;

export const V2_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
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
    status TEXT NOT NULL DEFAULT 'pending',
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS near_term_plan_items (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id),
    roadmap_stage_id TEXT REFERENCES roadmap_stages(id),
    item_index INTEGER NOT NULL,
    suggested_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    title TEXT NOT NULL,
    focus TEXT NOT NULL,
    tasks_json TEXT NOT NULL,
    expected_output TEXT NOT NULL,
    success_criteria TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plan_versions (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id),
    version INTEGER NOT NULL,
    change_summary TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS learning_guides (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id),
    near_term_plan_item_id TEXT REFERENCES near_term_plan_items(id),
    suggested_date TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    week_focus TEXT NOT NULL DEFAULT '',
    learning_goal TEXT NOT NULL,
    deliverables_json TEXT NOT NULL,
    boundaries_json TEXT NOT NULL,
    acceptance_criteria_json TEXT NOT NULL,
    next_actions_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    confirmed_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS learning_guides_near_term_item_unique
    ON learning_guides(near_term_plan_item_id)
    WHERE near_term_plan_item_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS learning_tasks (
    id TEXT PRIMARY KEY,
    goal_id TEXT REFERENCES goals(id),
    guide_id TEXT REFERENCES learning_guides(id),
    roadmap_stage_id TEXT REFERENCES roadmap_stages(id),
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
    difficulty TEXT,
    task_mode TEXT NOT NULL DEFAULT 'learning',
    status TEXT NOT NULL DEFAULT 'planned',
    closure_kind TEXT,
    next_start_point TEXT,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (difficulty IS NULL OR difficulty IN ('foundation', 'standard', 'advanced')),
    CHECK (task_mode IN ('learning', 'exam')),
    CHECK (status IN ('planned', 'active', 'deferred', 'closed')),
    CHECK (closure_kind IS NULL OR closure_kind IN ('completed', 'partial', 'abandoned', 'replaced')),
    CHECK (
      (status = 'closed' AND closure_kind IS NOT NULL)
      OR (status <> 'closed' AND closure_kind IS NULL)
    )
  );

  CREATE INDEX IF NOT EXISTS learning_tasks_guide_position_idx
    ON learning_tasks(guide_id, position);

  CREATE TABLE IF NOT EXISTS learning_actions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES learning_tasks(id),
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    requirement TEXT NOT NULL DEFAULT 'optional',
    status TEXT NOT NULL DEFAULT 'planned',
    progress_note TEXT,
    completed_at TEXT,
    position INTEGER NOT NULL,
    CHECK (requirement IN ('required', 'optional')),
    CHECK (status IN ('planned', 'done', 'skipped'))
  );

  CREATE INDEX IF NOT EXISTS learning_actions_task_position_idx
    ON learning_actions(task_id, position);

  CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES learning_tasks(id),
    started_at TEXT NOT NULL,
    active_since TEXT,
    ended_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    CHECK (duration_seconds >= 0),
    CHECK (status IN ('active', 'paused', 'ended')),
    CHECK (
      (status = 'active' AND active_since IS NOT NULL AND ended_at IS NULL)
      OR (status = 'paused' AND active_since IS NULL AND ended_at IS NULL)
      OR (status = 'ended' AND active_since IS NULL AND ended_at IS NOT NULL)
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS focus_sessions_single_unfinished
    ON focus_sessions((1))
    WHERE status IN ('active', 'paused');

  CREATE TABLE IF NOT EXISTS current_learning_context (
    id TEXT PRIMARY KEY,
    goal_id TEXT REFERENCES goals(id),
    guide_id TEXT REFERENCES learning_guides(id),
    task_id TEXT REFERENCES learning_tasks(id),
    action_id TEXT REFERENCES learning_actions(id),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_threads (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'open',
    kind TEXT NOT NULL DEFAULT 'question',
    question TEXT NOT NULL,
    resolution_summary TEXT,
    metadata TEXT,
    is_partial INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES conversation_threads(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    linked_goal_id TEXT REFERENCES goals(id),
    linked_task_id TEXT REFERENCES learning_tasks(id),
    linked_action_id TEXT REFERENCES learning_actions(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS learning_submissions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES learning_tasks(id),
    goal_id TEXT REFERENCES goals(id),
    session_id TEXT REFERENCES focus_sessions(id),
    content TEXT NOT NULL,
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
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER,
    error_category TEXT,
    trace_id TEXT,
    record_type TEXT NOT NULL DEFAULT 'legacy_call',
    parent_review_id TEXT REFERENCES ai_reviews(id),
    tool_name TEXT,
    tool_sequence INTEGER,
    idempotency_key TEXT,
    goal_id TEXT REFERENCES goals(id),
    conversation_scope TEXT,
    conversation_ref_id TEXT,
    message_ref_id TEXT,
    context_version INTEGER,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ai_reviews_parent_tool_idx
    ON ai_reviews(parent_review_id, tool_sequence);
  CREATE UNIQUE INDEX IF NOT EXISTS ai_reviews_idempotency_unique
    ON ai_reviews(idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS ai_reviews_one_active_run_per_scope
    ON ai_reviews(conversation_scope, conversation_ref_id)
    WHERE record_type = 'run' AND status IN ('running', 'waiting_user');

  CREATE TABLE IF NOT EXISTS learning_evaluations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'submission',
    submission_id TEXT REFERENCES learning_submissions(id),
    goal_id TEXT REFERENCES goals(id),
    result TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    correct_parts_json TEXT NOT NULL,
    misconceptions_json TEXT NOT NULL,
    missing_requirements_json TEXT NOT NULL,
    feedback TEXT NOT NULL,
    direction TEXT NOT NULL,
    self_note TEXT,
    recommendation_json TEXT,
    recommendation_decision TEXT,
    application_status TEXT,
    application_error TEXT,
    applied_at TEXT,
    ai_review_id TEXT REFERENCES ai_reviews(id),
    created_at TEXT NOT NULL,
    CHECK (kind IN ('submission', 'goal_review')),
    CHECK (
      (kind = 'submission' AND submission_id IS NOT NULL)
      OR (kind = 'goal_review' AND submission_id IS NULL AND goal_id IS NOT NULL)
    ),
    CHECK (result IN ('passed', 'partial', 'failed', 'unclear')),
    CHECK (direction IN ('advance', 'stay', 'remediate', 'replan')),
    CHECK (recommendation_decision IS NULL OR recommendation_decision IN ('pending', 'accepted', 'declined', 'deferred')),
    CHECK (application_status IS NULL OR application_status IN ('pending', 'applied', 'failed')),
    CHECK (
      (recommendation_json IS NULL
        AND recommendation_decision IS NULL
        AND application_status IS NULL
        AND application_error IS NULL
        AND applied_at IS NULL)
      OR recommendation_json IS NOT NULL
    ),
    CHECK (application_status IS NULL OR recommendation_decision = 'accepted'),
    CHECK (
      (application_status = 'applied' AND applied_at IS NOT NULL)
      OR (application_status IS NULL OR application_status <> 'applied') AND applied_at IS NULL
    )
  );

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

  CREATE TABLE IF NOT EXISTS learner_facts (
    id TEXT PRIMARY KEY,
    goal_id TEXT REFERENCES goals(id),
    task_id TEXT REFERENCES learning_tasks(id),
    scope TEXT NOT NULL DEFAULT 'goal',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.8,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_item_evidence (
    id TEXT PRIMARY KEY,
    knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id),
    source_type TEXT NOT NULL,
    source_id TEXT,
    submission_id TEXT REFERENCES learning_submissions(id),
    evaluation_id TEXT REFERENCES learning_evaluations(id),
    task_id TEXT REFERENCES learning_tasks(id),
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS knowledge_item_evidence_evaluation_unique
    ON knowledge_item_evidence(knowledge_item_id, evaluation_id)
    WHERE evaluation_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS pending_interactions (
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

  CREATE UNIQUE INDEX IF NOT EXISTS pending_interactions_one_open_per_run
    ON pending_interactions(run_review_id) WHERE status = 'open';
`;

export async function bootstrapDatabase(client: Client): Promise<void> {
  await client.executeMultiple(V2_SCHEMA_SQL);
  await runDatabaseMigrations(client);
  await client.execute({
    sql: `INSERT INTO app_settings (key, value, updated_at)
          VALUES ('schemaVersion', ?, ?)
          ON CONFLICT(key) DO NOTHING`,
    args: [V2_SCHEMA_VERSION, new Date().toISOString()]
  });
}
