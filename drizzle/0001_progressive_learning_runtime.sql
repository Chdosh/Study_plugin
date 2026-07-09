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
