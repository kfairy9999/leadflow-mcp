CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  contact_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  service TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('referral', 'website', 'phone', 'walk_in', 'other')),
  stage TEXT NOT NULL CHECK (stage IN ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost')),
  estimated_value_cents INTEGER NOT NULL CHECK (estimated_value_cents >= 0),
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'normal', 'high')),
  city TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('call', 'email', 'sms', 'visit', 'note')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'cancelled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads (stage);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads (updated_at);
CREATE INDEX IF NOT EXISTS idx_interactions_lead_time ON interactions (lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status_due ON follow_ups (status, due_at);
