ALTER TABLE plan_adjustment_proposals
  ADD COLUMN applied_task_id TEXT REFERENCES task_items(id);

ALTER TABLE plan_adjustment_proposals
  ADD COLUMN applied_at TEXT;

CREATE INDEX IF NOT EXISTS plan_adjustment_proposals_applied_task_idx
  ON plan_adjustment_proposals(applied_task_id);
