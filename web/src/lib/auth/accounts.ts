// Account management on top of Better Auth: the first-run setup, the Users
// page and the Account page. Trusted server-side calls only; every caller
// checks the signed-in user's role first.

import type { Db } from "@/lib/db/sqlite";
import { hashPassword, type Auth } from "./auth";
import { constantTimeEq, formatSetupCode, validatePassword, validateUsername } from "./util";

export type Role = "viewer" | "admin";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, admin: 1 };

export interface User {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: number;
}

export interface SessionInfo {
  id: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
}

export interface AuthUser {
  user: User;
  sessionId: string;
}

export type UserError = "duplicate" | "not-found" | "last-admin";

export const USER_ERROR_MESSAGES: Record<UserError, string> = {
  duplicate: "That username is already taken",
  "not-found": "User not found",
  "last-admin": "At least one enabled admin must remain",
};

type Row = Record<string, unknown>;

const secs = (d: unknown) => Math.floor(new Date(d as string | number | Date).getTime() / 1000);

/** Better Auth's user row as the shape the UI and API use. */
export function toUser(r: Row): User {
  return {
    id: String(r.id),
    username: String(r.displayUsername || r.username || r.name),
    role: r.role === "admin" ? "admin" : "viewer",
    disabled: !!r.banned,
    created_at: secs(r.createdAt),
  };
}

/** Map a Better Auth session to the app's user shape; null if the account is disabled. */
export function toAuthUser(s: { user: Record<string, unknown>; session: { id: string } } | null): AuthUser | null {
  if (!s || s.user.banned) return null;
  return { user: toUser(s.user), sessionId: s.session.id };
}

/** Better Auth needs an email; pxls has none, so each account gets a local placeholder. */
const placeholderEmail = (username: string) => `${username.toLowerCase()}@pxls.local`;

const security = (msg: string, fields: Record<string, unknown> = {}) => console.warn(`[security] ${msg}`, JSON.stringify(fields));

export class Accounts {
  private setupCode: string | null = null;

  constructor(
    readonly auth: Auth,
    private readonly db: Db,
  ) {}

  /** With no users yet, print the one-time setup code. */
  start() {
    if (this.userCount() === 0) {
      this.setupCode = formatSetupCode();
      // Printed on purpose, and only here: this is how the person with access
      // to the server proves they own it.
      console.warn("No user accounts exist yet. Open pxls in your browser and finish setup.");
      console.warn(`One-time setup code (valid until an admin exists or the server restarts): ${this.setupCode}`);
    }
  }

  /** For tests. */
  setSetupCode(code: string | null) {
    this.setupCode = code;
  }

  userCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n);
  }

  setupRequired(): boolean {
    return this.userCount() === 0;
  }

  private async ctx() {
    return this.auth.$context;
  }

  // ---- users -----------------------------------------------------------

  async listUsers(): Promise<User[]> {
    const rows = await (await this.ctx()).internalAdapter.listUsers(1000, 0, { field: "createdAt", direction: "asc" });
    return rows.map((r) => toUser(r as Row));
  }

  async getUser(id: string): Promise<User | null> {
    const row = typeof id === "string" && id ? await (await this.ctx()).internalAdapter.findUserById(id) : null;
    return row ? toUser(row as Row) : null;
  }

  private async insertUser(username: string, password: string, role: Role): Promise<User | "duplicate"> {
    const { internalAdapter } = await this.ctx();
    const lower = username.toLowerCase();
    if (await internalAdapter.findUserByEmail(placeholderEmail(lower))) return "duplicate";
    const exists = this.db.prepare('SELECT 1 FROM "user" WHERE username = ?').get(lower);
    if (exists) return "duplicate";
    const passwordHash = await hashPassword(password);
    const row = await internalAdapter.createUser(
      {
        name: username,
        email: placeholderEmail(lower),
        emailVerified: true,
        username: lower,
        displayUsername: username,
        role,
        banned: false,
      },
      { method: "admin" },
    );
    await internalAdapter.linkAccount({ userId: row.id, providerId: "credential", accountId: row.id, password: passwordHash });
    return toUser(row as Row);
  }

  /** Create a user (admin). */
  async createUser(username: string, password: string, role: Role) {
    const invalid = validateUsername(username) ?? validatePassword(password, username);
    if (invalid) return { ok: false as const, message: invalid };
    const r = await this.insertUser(username, password, role);
    return typeof r === "string" ? { ok: false as const, error: r } : { ok: true as const, user: r };
  }

  /** Change role and/or disabled. Disabling ends the user's sessions. */
  async updateUser(id: string, change: { role?: Role; disabled?: boolean }): Promise<User | UserError> {
    const { internalAdapter } = await this.ctx();
    const all = await this.listUsers();
    const target = all.find((u) => u.id === id);
    if (!target) return "not-found";
    const role = change.role ?? target.role;
    const disabled = change.disabled ?? target.disabled;
    const losesAdmin = target.role === "admin" && !target.disabled && (role !== "admin" || disabled);
    if (losesAdmin && all.filter((u) => u.role === "admin" && !u.disabled).length <= 1) return "last-admin";
    const row = await internalAdapter.updateUser(id, { role, banned: disabled, banReason: null, banExpires: null });
    if (disabled && !target.disabled) await internalAdapter.deleteUserSessions(id);
    return toUser(row as Row);
  }

  async deleteUser(id: string): Promise<true | UserError> {
    const { internalAdapter } = await this.ctx();
    const all = await this.listUsers();
    const target = all.find((u) => u.id === id);
    if (!target) return "not-found";
    if (target.role === "admin" && !target.disabled && all.filter((u) => u.role === "admin" && !u.disabled).length <= 1) {
      return "last-admin";
    }
    await internalAdapter.deleteUser(id);
    return true;
  }

  /** Admin sets a user's password and ends all of that user's sessions. */
  async setPassword(target: User, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const invalid = validatePassword(password, target.username);
    if (invalid) return { ok: false, message: invalid };
    const { internalAdapter } = await this.ctx();
    await internalAdapter.updatePassword(target.id, await hashPassword(password));
    await internalAdapter.deleteUserSessions(target.id);
    return { ok: true };
  }

  // ---- sessions --------------------------------------------------------

  async listSessions(userId: string): Promise<SessionInfo[]> {
    const rows = await (await this.ctx()).internalAdapter.listSessions(userId);
    return rows
      .map((s) => ({
        id: s.id,
        created_at: secs(s.createdAt),
        last_used_at: secs(s.updatedAt),
        expires_at: secs(s.expiresAt),
        user_agent: s.userAgent ?? null,
        ip: s.ipAddress ?? null,
      }))
      .sort((a, b) => b.last_used_at - a.last_used_at);
  }

  /** End one of `userId`'s sessions. False if it is not theirs. */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const { internalAdapter } = await this.ctx();
    const s = (await internalAdapter.listSessions(userId)).find((x) => x.id === sessionId);
    if (!s) return false;
    await internalAdapter.deleteSession(s.token);
    return true;
  }

  async revokeUserSessions(userId: string): Promise<number> {
    const { internalAdapter } = await this.ctx();
    const n = (await internalAdapter.listSessions(userId)).length;
    await internalAdapter.deleteUserSessions(userId);
    return n;
  }

  // ---- first-run setup -------------------------------------------------

  async setup(code: string, username: string, password: string): Promise<{ ok: true } | { ok: false; error: "bad-code" | "invalid"; message?: string }> {
    if (!this.setupCode || !this.setupRequired() || !constantTimeEq(code.trim(), this.setupCode)) {
      security("setup rejected: bad or unavailable setup code");
      return { ok: false, error: "bad-code" };
    }
    const invalid = validateUsername(username) ?? validatePassword(password, username);
    if (invalid) return { ok: false, error: "invalid", message: invalid };
    // Claim the code before the first await so two requests cannot both win.
    const claimed = this.setupCode;
    this.setupCode = null;
    try {
      const r = await this.insertUser(username, password, "admin");
      if (typeof r === "string") throw new Error(r);
    } catch (e) {
      this.setupCode = claimed;
      throw e;
    }
    security("first admin created", { user: username });
    return { ok: true };
  }
}
