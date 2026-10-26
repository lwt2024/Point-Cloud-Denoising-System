PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS single_admin ON users(role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_attempts (
    bucket TEXT PRIMARY KEY,
    started_at REAL NOT NULL,
    count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'created', 'uploading', 'queued', 'running', 'downloading',
        'evaluating', 'succeeded', 'failed', 'cancelled'
    )),
    retry_of TEXT REFERENCES tasks(id),
    input_summary_json TEXT NOT NULL,
    reference_summary_json TEXT,
    reference_coordinates_confirmed INTEGER NOT NULL DEFAULT 0,
    algorithm_version TEXT NOT NULL,
    model_version TEXT NOT NULL,
    config_version TEXT NOT NULL,
    remote_id TEXT UNIQUE,
    result_path TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    remote_cleanup_due_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_by_user ON tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS tasks_by_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL
);
