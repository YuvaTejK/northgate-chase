CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  legal_entity TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  rm_name TEXT NOT NULL,
  rm_email TEXT NOT NULL,
  analyst_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  stage_days INTEGER NOT NULL,
  days_open INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('Client', 'Internal')),
  state TEXT NOT NULL CHECK (state IN ('requested', 'received', 'waived')),
  request_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  received_at TEXT,
  waived_reason TEXT,
  chase_round INTEGER NOT NULL DEFAULT 1 CHECK (chase_round BETWEEN 1 AND 3)
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_ids TEXT NOT NULL,
  template_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'approved', 'scheduled', 'simulated_sent', 'cancelled')),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  scheduled_at TEXT,
  simulated_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  analyst_name TEXT NOT NULL,
  rm_name TEXT NOT NULL,
  priority TEXT NOT NULL,
  message TEXT NOT NULL,
  document_ids TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  description TEXT NOT NULL,
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_events_case_time ON case_events(case_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_case_time ON reminders(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handoffs_case_time ON handoffs(case_id, created_at DESC);
