-- User accounts, server-side sessions and login throttling.
-- Replaces the single shared PXLS_AUTH_TOKEN. Do not edit once released.

-- `username` is unique ignoring case. `password_hash` is an argon2id PHC string
-- (the per-user salt is part of it); never returned by the API.
CREATE TABLE users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash       TEXT NOT NULL,
    role                TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    disabled            INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL
);

-- One row per login (a "session family"). Refresh tokens are stored only as
-- SHA-256 hashes. `refresh_hash` is the current token, `prev_refresh_hash` the
-- one it replaced: presenting the previous token again means it was stolen or
-- replayed, so the whole session is revoked.
CREATE TABLE sessions (
    id                TEXT PRIMARY KEY NOT NULL,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash      TEXT NOT NULL,
    prev_refresh_hash TEXT,
    created_at        INTEGER NOT NULL,
    last_used_at      INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL,
    absolute_expires_at INTEGER NOT NULL,
    revoked_at        INTEGER,
    revoked_reason    TEXT,
    user_agent        TEXT,
    ip                TEXT
);
CREATE UNIQUE INDEX idx_sessions_refresh ON sessions(refresh_hash);
CREATE INDEX idx_sessions_prev_refresh ON sessions(prev_refresh_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Failed-attempt counters for lockout. `kind` is 'login-user', 'login-ip',
-- 'setup-ip' or 'password-user'; `key` is the lowercased username or the IP.
-- Rows exist for names that are not accounts too, so lockout reveals nothing.
CREATE TABLE login_attempts (
    kind         TEXT NOT NULL,
    key          TEXT NOT NULL,
    failures     INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, key)
);
