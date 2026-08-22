-- Conversation history and build plans (schema v3)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'text',
  active_goal_id TEXT,
  summary TEXT,
  model_profile_id TEXT
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('OWNER', 'JARVIS')),
  visible_text TEXT NOT NULL,
  input_mode TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started', 'completed', 'incomplete')),
  goal_id TEXT,
  plan_id TEXT,
  model_profile_id TEXT,
  memory_refs TEXT NOT NULL DEFAULT '[]',
  operation_refs TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_ts ON conversation_turns(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_status ON conversation_turns(status);

CREATE TABLE IF NOT EXISTS build_plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_build_plans_session ON build_plans(session_id, updated_at);
