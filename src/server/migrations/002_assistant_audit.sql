CREATE TABLE IF NOT EXISTS assistant_audit_log (
  request_id TEXT PRIMARY KEY,
  actor_name TEXT NOT NULL,
  role TEXT NOT NULL,
  intent TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  answer_length INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_audit_time ON assistant_audit_log(occurred_at DESC);
