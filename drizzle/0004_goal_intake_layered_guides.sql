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
