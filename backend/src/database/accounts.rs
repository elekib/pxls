//! Users, sessions and login throttling (tables from `0002_users_sessions.sql`).
//!
//! One long-lived connection behind a mutex: the auth middleware hits this on
//! every request, so it must not reopen the database each time. All times are
//! unix seconds and are passed in by the caller so tests can control the clock.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Admin,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "admin" => Some(Role::Admin),
            "viewer" => Some(Role::Viewer),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: Role,
    pub disabled: bool,
    pub created_at: i64,
    pub password_changed_at: i64,
}

/// A user plus the stored password hash. Never serialised.
pub struct UserWithHash {
    pub user: User,
    pub password_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: i64,
    pub last_used_at: i64,
    pub expires_at: i64,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum UserError {
    /// The username is already taken.
    Duplicate,
    NotFound,
    /// The change would leave no enabled admin.
    LastAdmin,
}

impl std::fmt::Display for UserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            UserError::Duplicate => "That username is already taken",
            UserError::NotFound => "User not found",
            UserError::LastAdmin => "At least one enabled admin must remain",
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rotation {
    Rotated {
        session_id: String,
        user_id: i64,
    },
    /// An already-replaced token was presented; the session has been revoked.
    Reuse {
        session_id: String,
        user_id: i64,
    },
    Invalid,
}

/// Outcome of a lockout check.
#[derive(Debug, PartialEq, Eq)]
pub enum Throttle {
    Open,
    /// Locked until this unix time.
    Locked(i64),
}

pub struct AccountsDb {
    conn: Mutex<Connection>,
}

fn user_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<User> {
    let role: String = r.get(2)?;
    Ok(User {
        id: r.get(0)?,
        username: r.get(1)?,
        role: Role::parse(&role).unwrap_or(Role::Viewer),
        disabled: r.get(3)?,
        created_at: r.get(4)?,
        password_changed_at: r.get(5)?,
    })
}

const USER_COLS: &str = "id, username, role, disabled, created_at, password_changed_at";

fn is_unique_violation(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

impl AccountsDb {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let conn = super::db::open(data_dir)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        super::db::off_executor(|| {
            let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut conn)
        })
    }

    // ---- bookkeeping ---------------------------------------------------

    /// Read a `meta` value, creating it with `make()` if absent.
    pub fn meta_get_or_create(&self, key: &str, make: impl FnOnce() -> String) -> Result<String> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let existing: Option<String> = tx
                .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                .optional()?;
            let value = match existing {
                Some(v) => v,
                None => {
                    let v = make();
                    tx.execute(
                        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
                        params![key, v],
                    )?;
                    v
                }
            };
            tx.commit()?;
            Ok(value)
        })
    }

    // ---- users ---------------------------------------------------------

    pub fn user_count(&self) -> Result<i64> {
        self.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?))
    }

    /// Create the first admin, only if there are no users yet. The check and
    /// the insert share one write transaction, so two racing setups cannot both win.
    pub fn create_first_admin(&self, username: &str, hash: &str, now: i64) -> Result<Option<User>> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let count: i64 = tx.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
            if count > 0 {
                return Ok(None);
            }
            tx.execute(
                "INSERT INTO users (username, password_hash, role, created_at, password_changed_at)
                 VALUES (?1, ?2, 'admin', ?3, ?3)",
                params![username, hash, now],
            )?;
            let user = tx.query_row(
                &format!("SELECT {USER_COLS} FROM users WHERE id = last_insert_rowid()"),
                [],
                user_from_row,
            )?;
            tx.commit()?;
            Ok(Some(user))
        })
    }

    pub fn create_user(
        &self,
        username: &str,
        hash: &str,
        role: Role,
        now: i64,
    ) -> Result<std::result::Result<User, UserError>> {
        self.with(|c| {
            let res = c.execute(
                "INSERT INTO users (username, password_hash, role, created_at, password_changed_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![username, hash, role.as_str(), now],
            );
            match res {
                Ok(_) => Ok(Ok(c.query_row(
                    &format!("SELECT {USER_COLS} FROM users WHERE id = last_insert_rowid()"),
                    [],
                    user_from_row,
                )?)),
                Err(e) if is_unique_violation(&e) => Ok(Err(UserError::Duplicate)),
                Err(e) => Err(e.into()),
            }
        })
    }

    pub fn find_user_with_hash(&self, username: &str) -> Result<Option<UserWithHash>> {
        self.with(|c| {
            Ok(c.query_row(
                &format!("SELECT {USER_COLS}, password_hash FROM users WHERE username = ?1"),
                [username],
                |r| {
                    Ok(UserWithHash {
                        user: user_from_row(r)?,
                        password_hash: r.get(6)?,
                    })
                },
            )
            .optional()?)
        })
    }

    pub fn user_with_hash_by_id(&self, id: i64) -> Result<Option<UserWithHash>> {
        self.with(|c| {
            Ok(c.query_row(
                &format!("SELECT {USER_COLS}, password_hash FROM users WHERE id = ?1"),
                [id],
                |r| {
                    Ok(UserWithHash {
                        user: user_from_row(r)?,
                        password_hash: r.get(6)?,
                    })
                },
            )
            .optional()?)
        })
    }

    pub fn get_user(&self, id: i64) -> Result<Option<User>> {
        self.with(|c| {
            Ok(c.query_row(
                &format!("SELECT {USER_COLS} FROM users WHERE id = ?1"),
                [id],
                user_from_row,
            )
            .optional()?)
        })
    }

    pub fn list_users(&self) -> Result<Vec<User>> {
        self.with(|c| {
            let mut stmt = c.prepare(&format!("SELECT {USER_COLS} FROM users ORDER BY id"))?;
            let rows = stmt.query_map([], user_from_row)?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        })
    }

    /// Set a new password hash and revoke every session of that user.
    pub fn set_password(&self, id: i64, hash: &str, now: i64) -> Result<bool> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let n = tx.execute(
                "UPDATE users SET password_hash = ?1, password_changed_at = ?2 WHERE id = ?3",
                params![hash, now, id],
            )?;
            revoke_sessions(&tx, id, None, now, "password-changed")?;
            tx.commit()?;
            Ok(n > 0)
        })
    }

    /// Change a user's role and/or disabled flag. Disabling revokes sessions.
    /// Refuses anything that would leave no enabled admin.
    pub fn update_user(
        &self,
        id: i64,
        role: Option<Role>,
        disabled: Option<bool>,
        now: i64,
    ) -> Result<std::result::Result<User, UserError>> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let Some(cur) = tx
                .query_row(
                    &format!("SELECT {USER_COLS} FROM users WHERE id = ?1"),
                    [id],
                    user_from_row,
                )
                .optional()?
            else {
                return Ok(Err(UserError::NotFound));
            };
            let new_role = role.unwrap_or(cur.role);
            let new_disabled = disabled.unwrap_or(cur.disabled);
            let was_active_admin = cur.role == Role::Admin && !cur.disabled;
            let is_active_admin = new_role == Role::Admin && !new_disabled;
            if was_active_admin && !is_active_admin && other_active_admins(&tx, id)? == 0 {
                return Ok(Err(UserError::LastAdmin));
            }
            tx.execute(
                "UPDATE users SET role = ?1, disabled = ?2 WHERE id = ?3",
                params![new_role.as_str(), new_disabled, id],
            )?;
            if new_disabled || new_role != cur.role {
                revoke_sessions(&tx, id, None, now, "account-changed")?;
            }
            let user = tx.query_row(
                &format!("SELECT {USER_COLS} FROM users WHERE id = ?1"),
                [id],
                user_from_row,
            )?;
            tx.commit()?;
            Ok(Ok(user))
        })
    }

    pub fn delete_user(&self, id: i64) -> Result<std::result::Result<(), UserError>> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let Some(cur) = tx
                .query_row(
                    &format!("SELECT {USER_COLS} FROM users WHERE id = ?1"),
                    [id],
                    user_from_row,
                )
                .optional()?
            else {
                return Ok(Err(UserError::NotFound));
            };
            if cur.role == Role::Admin && !cur.disabled && other_active_admins(&tx, id)? == 0 {
                return Ok(Err(UserError::LastAdmin));
            }
            tx.execute("DELETE FROM users WHERE id = ?1", [id])?;
            tx.commit()?;
            Ok(Ok(()))
        })
    }

    // ---- sessions ------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub fn create_session(
        &self,
        id: &str,
        user_id: i64,
        refresh_hash: &str,
        now: i64,
        idle_ttl: i64,
        absolute_ttl: i64,
        user_agent: Option<&str>,
        ip: Option<&str>,
    ) -> Result<()> {
        self.with(|c| {
            // Expired and long-revoked rows only clutter the list; drop them here.
            c.execute(
                "DELETE FROM sessions WHERE expires_at < ?1
                    OR (revoked_at IS NOT NULL AND revoked_at < ?1 - 86400)",
                [now],
            )?;
            c.execute(
                "INSERT INTO sessions (id, user_id, refresh_hash, created_at, last_used_at,
                    expires_at, absolute_expires_at, user_agent, ip)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    user_id,
                    refresh_hash,
                    now,
                    now + idle_ttl,
                    now + absolute_ttl,
                    user_agent,
                    ip
                ],
            )
            .context("Failed to create session")?;
            Ok(())
        })
    }

    /// Exchange the current refresh token for a new one.
    ///
    /// A token that was already replaced revokes the whole session (reuse
    /// detection). Expired, revoked, unknown, and disabled-user sessions are `Invalid`.
    pub fn rotate_session(
        &self,
        presented_hash: &str,
        new_hash: &str,
        now: i64,
        idle_ttl: i64,
    ) -> Result<Rotation> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            type Row = (String, i64, String, Option<String>, i64, i64, Option<i64>, bool);
            let row: Option<Row> = tx
                .query_row(
                    "SELECT s.id, s.user_id, s.refresh_hash, s.prev_refresh_hash, s.expires_at,
                            s.absolute_expires_at, s.revoked_at, u.disabled
                     FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.refresh_hash = ?1 OR s.prev_refresh_hash = ?1",
                    [presented_hash],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get(4)?,
                            r.get(5)?,
                            r.get(6)?,
                            r.get(7)?,
                        ))
                    },
                )
                .optional()?;
            let Some((sid, uid, current, _prev, expires, absolute, revoked, disabled)) = row else {
                return Ok(Rotation::Invalid);
            };
            if revoked.is_some() || disabled {
                return Ok(Rotation::Invalid);
            }
            if presented_hash != current {
                tx.execute(
                    "UPDATE sessions SET revoked_at = ?1, revoked_reason = 'refresh-reuse' WHERE id = ?2",
                    params![now, sid],
                )?;
                tx.commit()?;
                return Ok(Rotation::Reuse {
                    session_id: sid,
                    user_id: uid,
                });
            }
            if expires <= now || absolute <= now {
                return Ok(Rotation::Invalid);
            }
            let new_expiry = (now + idle_ttl).min(absolute);
            tx.execute(
                "UPDATE sessions SET prev_refresh_hash = refresh_hash, refresh_hash = ?1,
                    last_used_at = ?2, expires_at = ?3 WHERE id = ?4",
                params![new_hash, now, new_expiry, sid],
            )?;
            tx.commit()?;
            Ok(Rotation::Rotated {
                session_id: sid,
                user_id: uid,
            })
        })
    }

    /// The user behind an access token, if its session is still live.
    pub fn session_user(&self, session_id: &str, user_id: i64, now: i64) -> Result<Option<User>> {
        self.with(|c| {
            Ok(c.query_row(
                "SELECT u.id, u.username, u.role, u.disabled, u.created_at, u.password_changed_at
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.id = ?1 AND u.id = ?2 AND s.revoked_at IS NULL
                   AND s.expires_at > ?3 AND s.absolute_expires_at > ?3 AND u.disabled = 0",
                params![session_id, user_id, now],
                user_from_row,
            )
            .optional()?)
        })
    }

    pub fn list_sessions(&self, user_id: i64, now: i64) -> Result<Vec<SessionInfo>> {
        self.with(|c| {
            let mut stmt = c.prepare(
                "SELECT id, created_at, last_used_at, expires_at, user_agent, ip FROM sessions
                 WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2
                 ORDER BY last_used_at DESC",
            )?;
            let rows = stmt.query_map(params![user_id, now], |r| {
                Ok(SessionInfo {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    last_used_at: r.get(2)?,
                    expires_at: r.get(3)?,
                    user_agent: r.get(4)?,
                    ip: r.get(5)?,
                })
            })?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        })
    }

    /// Session id for a presented refresh token (current or replaced), if any.
    pub fn session_for_refresh(&self, refresh_hash: &str) -> Result<Option<(String, i64)>> {
        self.with(|c| {
            Ok(c.query_row(
                "SELECT id, user_id FROM sessions WHERE refresh_hash = ?1 OR prev_refresh_hash = ?1",
                [refresh_hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
        })
    }

    /// Revoke one session belonging to `user_id`. False if there was none.
    pub fn revoke_session(
        &self,
        user_id: i64,
        session_id: &str,
        now: i64,
        reason: &str,
    ) -> Result<bool> {
        self.with(|c| {
            let n = c.execute(
                "UPDATE sessions SET revoked_at = ?1, revoked_reason = ?2
                 WHERE id = ?3 AND user_id = ?4 AND revoked_at IS NULL",
                params![now, reason, session_id, user_id],
            )?;
            Ok(n > 0)
        })
    }

    /// Revoke all of a user's sessions, optionally keeping one. Returns how many.
    pub fn revoke_user_sessions(
        &self,
        user_id: i64,
        except: Option<&str>,
        now: i64,
        reason: &str,
    ) -> Result<usize> {
        self.with(|c| revoke_sessions(c, user_id, except, now, reason))
    }

    // ---- throttling ----------------------------------------------------

    pub fn throttle_check(&self, kind: &str, key: &str, now: i64) -> Result<Throttle> {
        self.with(|c| {
            let locked: Option<i64> = c
                .query_row(
                    "SELECT locked_until FROM login_attempts WHERE kind = ?1 AND key = ?2",
                    params![kind, key],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(match locked {
                Some(until) if until > now => Throttle::Locked(until),
                _ => Throttle::Open,
            })
        })
    }

    /// Record a failure. After `max` failures inside `window` seconds the key
    /// is locked for `lock` seconds. Returns true if this failure locked it.
    pub fn throttle_fail(
        &self,
        kind: &str,
        key: &str,
        now: i64,
        max: i64,
        window: i64,
        lock: i64,
    ) -> Result<bool> {
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            // Old counters for names that never came back are just clutter.
            tx.execute(
                "DELETE FROM login_attempts WHERE locked_until < ?1 AND window_start < ?1 - 86400",
                [now],
            )?;
            let cur: Option<(i64, i64)> = tx
                .query_row(
                    "SELECT failures, window_start FROM login_attempts WHERE kind = ?1 AND key = ?2",
                    params![kind, key],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let (failures, start) = match cur {
                Some((f, s)) if now - s < window => (f + 1, s),
                _ => (1, now),
            };
            let locks = failures >= max;
            let (stored, until) = if locks { (0, now + lock) } else { (failures, 0) };
            tx.execute(
                "INSERT INTO login_attempts (kind, key, failures, window_start, locked_until)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(kind, key) DO UPDATE SET failures = ?3, window_start = ?4,
                    locked_until = ?5",
                params![kind, key, stored, start, until],
            )?;
            tx.commit()?;
            Ok(locks)
        })
    }

    pub fn throttle_clear(&self, kind: &str, key: &str) -> Result<()> {
        self.with(|c| {
            c.execute(
                "DELETE FROM login_attempts WHERE kind = ?1 AND key = ?2",
                params![kind, key],
            )?;
            Ok(())
        })
    }
}

fn other_active_admins(conn: &Connection, except: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?1",
        [except],
        |r| r.get(0),
    )?)
}

fn revoke_sessions(
    conn: &Connection,
    user_id: i64,
    except: Option<&str>,
    now: i64,
    reason: &str,
) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE sessions SET revoked_at = ?1, revoked_reason = ?2
         WHERE user_id = ?3 AND revoked_at IS NULL AND id != ?4",
        params![now, reason, user_id, except.unwrap_or("")],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn db() -> (AccountsDb, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("pxls-acct-{}", uuid::Uuid::new_v4().simple()));
        (AccountsDb::open(&dir).unwrap(), dir)
    }

    #[test]
    fn migration_creates_the_account_tables_without_touching_old_ones() {
        let (d, dir) = db();
        d.with(|c| {
            for t in [
                "users",
                "sessions",
                "login_attempts",
                "app_config",
                "webhooks",
            ] {
                let n: i64 = c.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [t],
                    |r| r.get(0),
                )?;
                assert_eq!(n, 1, "{t}");
            }
            let v: Vec<u32> = c
                .prepare("SELECT version FROM schema_version ORDER BY version")?
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            assert_eq!(v, vec![1, 2]);
            Ok(())
        })
        .unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn jwt_secret_is_created_once_and_persists_across_restarts() {
        let (d, dir) = db();
        let a = d
            .meta_get_or_create("jwt_secret", || "first".into())
            .unwrap();
        let b = d
            .meta_get_or_create("jwt_secret", || "second".into())
            .unwrap();
        assert_eq!((a.as_str(), b.as_str()), ("first", "first"));
        drop(d);
        let again = AccountsDb::open(&dir).unwrap();
        assert_eq!(
            again
                .meta_get_or_create("jwt_secret", || "third".into())
                .unwrap(),
            "first"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_one_concurrent_setup_wins() {
        let (d, dir) = db();
        let d = Arc::new(d);
        let wins: usize = (0..8)
            .map(|i| {
                let d = d.clone();
                std::thread::spawn(move || {
                    d.create_first_admin(&format!("admin{i}"), "hash", 1)
                        .unwrap()
                        .is_some()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap() as usize)
            .sum();
        assert_eq!(wins, 1);
        assert_eq!(d.user_count().unwrap(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn throttle_locks_after_max_failures_and_expires() {
        let (d, dir) = db();
        let t0 = 1_000_000;
        for i in 0..4 {
            assert!(!d.throttle_fail("k", "a", t0 + i, 5, 900, 900).unwrap());
        }
        assert_eq!(d.throttle_check("k", "a", t0 + 5).unwrap(), Throttle::Open);
        assert!(d.throttle_fail("k", "a", t0 + 5, 5, 900, 900).unwrap());
        assert_eq!(
            d.throttle_check("k", "a", t0 + 6).unwrap(),
            Throttle::Locked(t0 + 905)
        );
        assert_eq!(
            d.throttle_check("k", "a", t0 + 905).unwrap(),
            Throttle::Open
        );
        // Counting starts over after the lock, and failures outside the window do not add up.
        assert!(!d.throttle_fail("k", "b", t0, 2, 900, 900).unwrap());
        assert!(!d.throttle_fail("k", "b", t0 + 2000, 2, 900, 900).unwrap());
        d.throttle_clear("k", "b").unwrap();
        assert_eq!(d.throttle_check("k", "b", t0).unwrap(), Throttle::Open);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sessions_expire_idle_and_absolute_and_for_disabled_users() {
        let (d, dir) = db();
        let u = d.create_user("u1", "h", Role::Viewer, 0).unwrap().unwrap();
        d.create_session("s1", u.id, "r1", 100, 50, 120, None, None)
            .unwrap();
        assert!(d.session_user("s1", u.id, 120).unwrap().is_some());
        assert!(
            d.session_user("s1", u.id, 150).unwrap().is_none(),
            "idle expiry"
        );

        // Sliding expiry is capped by the absolute limit.
        assert!(matches!(
            d.rotate_session("r1", "r2", 110, 50).unwrap(),
            Rotation::Rotated { .. }
        ));
        assert!(
            d.session_user("s1", u.id, 215).unwrap().is_none(),
            "absolute expiry at 220 minus nothing: idle cap"
        );
        assert_eq!(
            d.rotate_session("r2", "r3", 300, 50).unwrap(),
            Rotation::Invalid
        );

        d.create_session("s2", u.id, "q1", 100, 500, 900, None, None)
            .unwrap();
        d.update_user(u.id, None, Some(true), 101).unwrap().unwrap();
        assert_eq!(
            d.rotate_session("q1", "q2", 102, 500).unwrap(),
            Rotation::Invalid
        );
        assert!(d.session_user("s2", u.id, 102).unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
