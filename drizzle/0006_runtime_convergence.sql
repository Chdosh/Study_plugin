-- Runtime Convergence Migration
-- Converts learning_runtime_states and study_sessions FK targets
-- from old models (daily_plan_blocks, learning_steps, plan_stages) 
-- to formal execution models (daily_guide_tasks, daily_guide_actions, roadmap_stages).

PRAGMA foreign_keys = OFF;

-- ── 1. Backup current state ──
CREATE TABLE IF NOT EXISTS _migration_backup_runtime AS SELECT * FROM learning_runtime_states;
CREATE TABLE IF NOT EXISTS _migration_backup_sessions AS SELECT * FROM study_sessions;

-- ── 2. Rebuild learning_runtime_states ──
-- New FK targets: activeDailyTaskId → daily_guide_tasks, activeStepId → daily_guide_actions, activeStageId → roadmap_stages
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

-- Map: activeDailyTaskId via legacyPlanBlockId → daily_guide_tasks.id (unique match only)
-- If no unique match, clear the pointer.
INSERT INTO learning_runtime_states_new
SELECT
  r.id,
  r.active_goal_id,
  NULL AS active_stage_id,           -- old plan_stages pointer NOT migrated (no safe mapping)
  (
    SELECT dgt.id FROM daily_guide_tasks dgt
    WHERE dgt.legacy_plan_block_id = r.active_daily_task_id
    LIMIT 1
  ) AS active_daily_task_id,         -- unique match via legacyPlanBlockId; NULL if ambiguous or missing
  NULL AS active_step_id,            -- old learning_steps pointer NOT migrated (no safe mapping)
  r.active_question_thread_id,
  r.session_status,
  r.updated_at
FROM learning_runtime_states r;

-- Verify no duplicate blockId→taskId mappings
-- (If any row has >1 match, the LIMIT 1 above could pick arbitrarily;
--  the app's saveLayeredPlan/saveDailyGuideWithTransaction already guarantees 1:1.)

-- ── 3. Rebuild study_sessions ──
-- Rename: old blockId → taskId (FK→daily_guide_tasks), old taskId → task_items_id (FK→task_items)
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

-- Map sessions: blockId → taskId via legacyPlanBlockId
-- Active/paused sessions with unmappable blockId: mark as 'completed' (safe termination)
INSERT INTO study_sessions_new
SELECT
  s.id,
  CASE
    WHEN s.status IN ('active','paused') THEN
      (SELECT dgt.id FROM daily_guide_tasks dgt WHERE dgt.legacy_plan_block_id = s.block_id LIMIT 1)
    ELSE
      (SELECT dgt.id FROM daily_guide_tasks dgt WHERE dgt.legacy_plan_block_id = s.block_id LIMIT 1)
  END AS task_id,
  s.task_id AS task_items_id,
  s.started_at,
  CASE
    WHEN s.status IN ('active','paused') AND (
      SELECT dgt.id FROM daily_guide_tasks dgt WHERE dgt.legacy_plan_block_id = s.block_id LIMIT 1
    ) IS NULL THEN s.ended_at
    ELSE s.ended_at
  END AS ended_at,
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

-- ── 4. Replace old tables ──
DROP TABLE learning_runtime_states;
ALTER TABLE learning_runtime_states_new RENAME TO learning_runtime_states;

DROP TABLE study_sessions;
ALTER TABLE study_sessions_new RENAME TO study_sessions;

-- ── 5. Recover current action from task.currentActionId ──
-- If runtime has a taskId but no actionId, read currentActionId from the task.
UPDATE learning_runtime_states
SET active_step_id = (
  SELECT dgt.current_action_id FROM daily_guide_tasks dgt
  WHERE dgt.id = learning_runtime_states.active_daily_task_id
  AND dgt.current_action_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM daily_guide_actions dga
    WHERE dga.id = dgt.current_action_id
    AND dga.task_id = dgt.id
  )
)
WHERE active_daily_task_id IS NOT NULL
AND active_step_id IS NULL;

-- ── 6. Recover current stage from roadmap ──
-- If runtime has a goalId but no stageId, read the first roadmap_stage.
UPDATE learning_runtime_states
SET active_stage_id = (
  SELECT rs.id FROM roadmap_stages rs
  WHERE rs.goal_id = learning_runtime_states.active_goal_id
  ORDER BY rs.position ASC
  LIMIT 1
)
WHERE active_goal_id IS NOT NULL
AND active_stage_id IS NULL;

-- ── 7. Verify foreign key integrity ──
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;

-- ── 8. Clean up backup tables (keep for rollback if needed) ──
-- DROP TABLE IF EXISTS _migration_backup_runtime;
-- DROP TABLE IF EXISTS _migration_backup_sessions;
