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
