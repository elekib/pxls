// Users, sessions and login throttling (tables from migration 0002).
// Port of backend/src/database/accounts.rs; same SQL and rules. All times are
// unix seconds passed in by the caller, so tests control the clock.

import { tx, type Db } from "@/lib/db/sqlite";

export type Role = "viewer" | "admin";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, admin: 1 };

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: number;
  password_changed_at: number;
}

export interface UserWithHash {
  user: User;
  passwordHash: string;
}

export interface SessionInfo {
  id: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
}

export type UserError = "duplicate" | "not-found" | "last-admin";

export const USER_ERROR_MESSAGES: Record<UserError, string> = {
  duplicate: "That username is already taken",
  "not-found": "User not found",
  "last-admin": "At least one enabled admin must remain",
};

export type Rotation =
  | { kind: "rotated"; sessionId: string; userId: number }
  /** An already-replaced token was presented; the session has been revoked. */
  | { kind: "reuse"; sessionId: string; userId: number }
  | { kind: "invalid" };

type Row = Record<string, unknown>;

const USER_COLS = "id, username, role, disabled, created_at, password_changed_at";

function toUser(r: Row): User {
  return {
    id: Number(r.id),
    username: String(r.username),
    role: r.role === "admin" ? "admin" : "viewer",
    disabled: Number(r.disabled) !== 0,
    created_at: Number(r.created_at),
    password_changed_at: Number(r.password_changed_at),
  };
}

const int = (b: boolean) => (b ? 1 : 0);

function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/.test((e as Error)?.message ?? "");
}

export class AccountsStore {
  constructor(private readonly db: Db) {}

  // ---- bookkeeping -------------------------------------------------------

  /** Read a `meta` value, creating it with `make()` if absent. */
  metaGetOrCreate(key: string, make: () => string): string {
    return tx(this.db, () => {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
      if (row) return String(row.value);
      const value = make();
      this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, value);
      return value;
    });
  }

  // ---- users -------------------------------------------------------------

  userCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as Row).n);
  }

  /** Create the first admin, only if there are no users yet (one transaction). */
  createFirstAdmin(username: string, hash: string, now: number): User | null {
    return tx(this.db, () => {
      if (this.userCount() > 0) return null;
      const r = this.db
        .prepare(
          `INSERT INTO users (username, password_hash, role, created_at, password_changed_at)
           VALUES (?, ?, 'admin', ?, ?)`,
        )
        .run(username, hash, now, now);
      return this.getUser(Number(r.lastInsertRowid));
    });
  }

  createUser(username: string, hash: string, role: Role, now: number): User | UserError {
    try {
      const r = this.db
        .prepare(
          `INSERT INTO users (username, password_hash, role, created_at, password_changed_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(username, hash, role, now, now);
      return this.getUser(Number(r.lastInsertRowid))!;
    } catch (e) {
      if (isUniqueViolation(e)) return "duplicate";
      throw e;
    }
  }

  findUserWithHash(username: string): UserWithHash | null {
    const r = this.db
      .prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = ?`)
      .get(username) as Row | undefined;
    return r ? { user: toUser(r), passwordHash: String(r.password_hash) } : null;
  }

  userWithHashById(id: number): UserWithHash | null {
    const r = this.db.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return r ? { user: toUser(r), passwordHash: String(r.password_hash) } : null;
  }

  getUser(id: number): User | null {
    const r = this.db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as Row | undefined;
    return r ? toUser(r) : null;
  }

  listUsers(): User[] {
    return (this.db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY id`).all() as Row[]).map(toUser);
  }

  /** Set a new password hash and revoke every session of that user. */
  setPassword(id: number, hash: string, now: number): boolean {
    return tx(this.db, () => {
      const r = this.db
        .prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?")
        .run(hash, now, id);
      this.revokeSessionsIn(id, null, now, "password-changed");
      return Number(r.changes) > 0;
    });
  }

  /**
   * Change a user's role and/or disabled flag. Disabling or a role change
   * revokes sessions. Refuses anything that leaves no enabled admin.
   */
  updateUser(id: number, role: Role | undefined, disabled: boolean | undefined, now: number): User | UserError {
    return tx(this.db, () => {
      const cur = this.getUser(id);
      if (!cur) return "not-found";
      const newRole = role ?? cur.role;
      const newDisabled = disabled ?? cur.disabled;
      const wasActiveAdmin = cur.role === "admin" && !cur.disabled;
      const isActiveAdmin = newRole === "admin" && !newDisabled;
      if (wasActiveAdmin && !isActiveAdmin && this.otherActiveAdmins(id) === 0) return "last-admin";
      this.db.prepare("UPDATE users SET role = ?, disabled = ? WHERE id = ?").run(newRole, int(newDisabled), id);
      if (newDisabled || newRole !== cur.role) this.revokeSessionsIn(id, null, now, "account-changed");
      return this.getUser(id)!;
    });
  }

  deleteUser(id: number): true | UserError {
    return tx(this.db, () => {
      const cur = this.getUser(id);
      if (!cur) return "not-found";
      if (cur.role === "admin" && !cur.disabled && this.otherActiveAdmins(id) === 0) return "last-admin";
      this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
      return true;
    });
  }

  private otherActiveAdmins(except: number): number {
    return Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?")
          .get(except) as Row
      ).n,
    );
  }

  // ---- sessions ----------------------------------------------------------

  createSession(s: {
    id: string;
    userId: number;
    refreshHash: string;
    now: number;
    idleTtl: number;
    absoluteTtl: number;
    userAgent: string | null;
    ip: string | null;
  }): void {
    // Expired and long-revoked rows only clutter the list; drop them here.
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ? - 86400)")
      .run(s.now, s.now);
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, refresh_hash, created_at, last_used_at,
           expires_at, absolute_expires_at, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.userId, s.refreshHash, s.now, s.now, s.now + s.idleTtl, s.now + s.absoluteTtl, s.userAgent, s.ip);
  }

  /**
   * Exchange the current refresh token for a new one. A token that was already
   * replaced revokes the whole session (reuse detection).
   */
  rotateSession(presentedHash: string, newHash: string, now: number, idleTtl: number): Rotation {
    return tx(this.db, () => {
      const r = this.db
        .prepare(
          `SELECT s.id, s.user_id, s.refresh_hash, s.expires_at, s.absolute_expires_at, s.revoked_at, u.disabled
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.refresh_hash = ? OR s.prev_refresh_hash = ?`,
        )
        .get(presentedHash, presentedHash) as Row | undefined;
      if (!r) return { kind: "invalid" } as const;
      if (r.revoked_at !== null || Number(r.disabled) !== 0) return { kind: "invalid" } as const;
      const sessionId = String(r.id);
      const userId = Number(r.user_id);
      if (presentedHash !== r.refresh_hash) {
        this.db
          .prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = 'refresh-reuse' WHERE id = ?")
          .run(now, sessionId);
        return { kind: "reuse", sessionId, userId } as const;
      }
      const absolute = Number(r.absolute_expires_at);
      if (Number(r.expires_at) <= now || absolute <= now) return { kind: "invalid" } as const;
      this.db
        .prepare(
          `UPDATE sessions SET prev_refresh_hash = refresh_hash, refresh_hash = ?,
             last_used_at = ?, expires_at = ? WHERE id = ?`,
        )
        .run(newHash, now, Math.min(now + idleTtl, absolute), sessionId);
      return { kind: "rotated", sessionId, userId } as const;
    });
  }

  /** The user behind a session id, if the session is still live. */
  sessionUser(sessionId: string, userId: number, now: number): User | null {
    const r = this.db
      .prepare(
        `SELECT u.id, u.username, u.role, u.disabled, u.created_at, u.password_changed_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND u.id = ? AND s.revoked_at IS NULL
           AND s.expires_at > ? AND s.absolute_expires_at > ? AND u.disabled = 0`,
      )
      .get(sessionId, userId, now, now) as Row | undefined;
    return r ? toUser(r) : null;
  }

  /**
   * Browser sessions: the live session whose current token hash matches the
   * cookie. Slides the idle expiry (capped at the absolute expiry) at most once
   * a minute. Browser cookies do not rotate, so concurrent page loads are safe.
   */
  touchCookieSession(refreshHash: string, now: number, idleTtl: number): { sessionId: string; user: User } | null {
    const r = this.db
      .prepare(
        `SELECT s.id AS sid, s.last_used_at, s.absolute_expires_at,
                u.id, u.username, u.role, u.disabled, u.created_at, u.password_changed_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.refresh_hash = ? AND s.revoked_at IS NULL
           AND s.expires_at > ? AND s.absolute_expires_at > ? AND u.disabled = 0`,
      )
      .get(refreshHash, now, now) as Row | undefined;
    if (!r) return null;
    if (now - Number(r.last_used_at) >= 60) {
      this.db
        .prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?")
        .run(now, Math.min(now + idleTtl, Number(r.absolute_expires_at)), String(r.sid));
    }
    return { sessionId: String(r.sid), user: toUser(r) };
  }

  listSessions(userId: number, now: number): SessionInfo[] {
    return (
      this.db
        .prepare(
          `SELECT id, created_at, last_used_at, expires_at, user_agent, ip FROM sessions
           WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
           ORDER BY last_used_at DESC`,
        )
        .all(userId, now) as Row[]
    ).map((r) => ({
      id: String(r.id),
      created_at: Number(r.created_at),
      last_used_at: Number(r.last_used_at),
      expires_at: Number(r.expires_at),
      user_agent: (r.user_agent as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
    }));
  }

  /** Session for a presented refresh token (current or replaced), if any. */
  sessionForRefresh(refreshHash: string): { sessionId: string; userId: number } | null {
    const r = this.db
      .prepare("SELECT id, user_id FROM sessions WHERE refresh_hash = ? OR prev_refresh_hash = ?")
      .get(refreshHash, refreshHash) as Row | undefined;
    return r ? { sessionId: String(r.id), userId: Number(r.user_id) } : null;
  }

  /** Revoke one session belonging to `userId`. False if there was none. */
  revokeSession(userId: number, sessionId: string, now: number, reason: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE sessions SET revoked_at = ?, revoked_reason = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(now, reason, sessionId, userId);
    return Number(r.changes) > 0;
  }

  /** Revoke all of a user's sessions, optionally keeping one. Returns how many. */
  revokeUserSessions(userId: number, except: string | null, now: number, reason: string): number {
    return this.revokeSessionsIn(userId, except, now, reason);
  }

  private revokeSessionsIn(userId: number, except: string | null, now: number, reason: string): number {
    const r = this.db
      .prepare(
        `UPDATE sessions SET revoked_at = ?, revoked_reason = ?
         WHERE user_id = ? AND revoked_at IS NULL AND id != ?`,
      )
      .run(now, reason, userId, except ?? "");
    return Number(r.changes);
  }

  // ---- throttling --------------------------------------------------------

  /** Locked-until time if `key` is locked out, else null. */
  throttleCheck(kind: string, key: string, now: number): number | null {
    const r = this.db.prepare("SELECT locked_until FROM login_attempts WHERE kind = ? AND key = ?").get(kind, key) as
      | Row
      | undefined;
    const until = r ? Number(r.locked_until) : 0;
    return until > now ? until : null;
  }

  /**
   * Record a failure. After `max` failures inside `window` seconds the key is
   * locked for `lock` seconds. Returns true if this failure locked it.
   */
  throttleFail(kind: string, key: string, now: number, max: number, window: number, lock: number): boolean {
    return tx(this.db, () => {
      // Old counters for names that never came back are just clutter.
      this.db.prepare("DELETE FROM login_attempts WHERE locked_until < ? AND window_start < ? - 86400").run(now, now);
      const cur = this.db
        .prepare("SELECT failures, window_start FROM login_attempts WHERE kind = ? AND key = ?")
        .get(kind, key) as Row | undefined;
      let failures = 1;
      let start = now;
      if (cur && now - Number(cur.window_start) < window) {
        failures = Number(cur.failures) + 1;
        start = Number(cur.window_start);
      }
      const locks = failures >= max;
      this.db
        .prepare(
          `INSERT INTO login_attempts (kind, key, failures, window_start, locked_until)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(kind, key) DO UPDATE SET failures = excluded.failures,
             window_start = excluded.window_start, locked_until = excluded.locked_until`,
        )
        .run(kind, key, locks ? 0 : failures, start, locks ? now + lock : 0);
      return locks;
    });
  }

  throttleClear(kind: string, key: string): void {
    this.db.prepare("DELETE FROM login_attempts WHERE kind = ? AND key = ?").run(kind, key);
  }
}
