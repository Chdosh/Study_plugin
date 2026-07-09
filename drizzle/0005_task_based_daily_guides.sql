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
