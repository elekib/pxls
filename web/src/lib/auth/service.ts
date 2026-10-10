// User accounts: password hashing, access tokens, sessions and lockout.
// Port of backend/src/accounts.rs with the same rules and limits.
//
// - Passwords: argon2id with the Rust crate's defaults (m=19456, t=2, p=1), so
//   hashes written by either app verify in the other.
// - Access tokens: HS256 JWTs ({sub, sid, iat, exp}) signed with the same key
//   (PXLS_JWT_SECRET or meta.jwt_secret). Every check also hits the session
//   row, so revocation is immediate.
// - Refresh tokens (script API, cookie on /api/auth) rotate on use; presenting a
//   replaced one revokes the session.
// - Browser sessions (cookie on /) use the same sessions table but do not
//   rotate, so parallel server-component requests are safe.
// - Failed logins are counted per name and per IP. Unknown names count too,
//   and an unknown name still costs one argon2 verify, so nothing reveals
//   which accounts exist. Logs never contain passwords or tokens.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { jwtVerify, SignJWT } from "jose";
import { AccountsStore, type Role, type User } from "./store";

export const JWT_SECRET_ENV = "PXLS_JWT_SECRET";
export const MIN_JWT_SECRET_LEN = 32;

export const ACCESS_TTL_SECS = 15 * 60;
/** A session token that is not used for this long expires. */
export const REFRESH_IDLE_TTL_SECS = 7 * 24 * 3600;
/** A session never lasts longer than this, however active. */
export const SESSION_MAX_SECS = 30 * 24 * 3600;

export const MIN_PASSWORD_LEN = 12;
export const MAX_PASSWORD_LEN = 128;
export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 32;

const ACCOUNT_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;
const SETUP_MAX_FAILURES = 10;
const FAILURE_WINDOW_SECS = 15 * 60;
const LOCK_SECS = 15 * 60;

const JWT_SECRET_META_KEY = "jwt_secret";

// algorithm 2 = Argon2id (Algorithm is a const enum, which isolatedModules cannot import).
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const nowSecs = () => Math.floor(Date.now() / 1000);

const security = (msg: string, fields: Record<string, unknown> = {}) =>
  console.warn(`[security] ${msg}`, JSON.stringify(fields));

// ---- hashing -----------------------------------------------------------

export const randomToken = () => randomBytes(32).toString("base64url");

export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const hashPassword = (password: string) => argonHash(password, ARGON);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Compare without short-circuiting on the first difference. */
export function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

// ---- input rules -------------------------------------------------------

export function validateUsername(username: string): string | null {
  const n = [...username].length;
  if (n < MIN_USERNAME_LEN || n > MAX_USERNAME_LEN) {
    return `Username must be ${MIN_USERNAME_LEN} to ${MAX_USERNAME_LEN} characters`;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    return "Username may only contain letters, numbers, '.', '_' and '-'";
  }
  return null;
}

export function validatePassword(password: string, username: string): string | null {
  const n = [...password].length;
  if (n < MIN_PASSWORD_LEN) return `Password must be at least ${MIN_PASSWORD_LEN} characters`;
  if (n > MAX_PASSWORD_LEN) return `Password must be at most ${MAX_PASSWORD_LEN} characters`;
  if (password.toLowerCase() === username.toLowerCase()) return "Password must not be the same as the username";
  return null;
}

/** 24 hex characters in groups of four, like the Rust setup code. */
export const formatSetupCode = () => randomBytes(12).toString("hex").match(/.{4}/g)!.join("-");

const logKey = (name: string) => createHash("sha256").update(name.toLowerCase()).digest("hex").slice(0, 8);
const throttleKey = (name: string) => [...name.trim().toLowerCase()].slice(0, 64).join("");
const retryAfter = (until: number, now: number) => Math.max(until - now, 1);

// ---- results -----------------------------------------------------------

export interface Tokens {
  accessToken: string;
  expiresIn: number;
  user: User;
  refreshToken: string;
  refreshMaxAge: number;
}

export interface AuthUser {
  user: User;
  sessionId: string;
}

export type Fail<K extends string> = { ok: false; error: K; retryAfter?: number; message?: string };
export type Result<T, K extends string> = { ok: true; value: T } | Fail<K>;

// ---- service -----------------------------------------------------------

export class AuthService {
  private setupCode: string | null = null;
  private dummyHash: Promise<string>;
  private readonly key: Uint8Array;
  readonly allowedOrigins: string[];

  constructor(
    readonly store: AccountsStore,
    secret: string,
    allowedOrigins = "",
  ) {
    this.key = new TextEncoder().encode(secret);
    this.dummyHash = hashPassword("dummy-password-for-timing");
    this.allowedOrigins = allowedOrigins
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, "").toLowerCase())
      .filter(Boolean);
  }

  /** Load or create the JWT key and, with no users yet, print the setup code. */
  static init(store: AccountsStore, env: Record<string, string | undefined> = process.env): AuthService {
    let secret = env[JWT_SECRET_ENV]?.trim();
    if (secret) {
      if (secret.length < MIN_JWT_SECRET_LEN) {
        throw new Error(`${JWT_SECRET_ENV} must be at least ${MIN_JWT_SECRET_LEN} characters`);
      }
    } else {
      secret = store.metaGetOrCreate(JWT_SECRET_META_KEY, () => randomBytes(32).toString("hex"));
    }
    const service = new AuthService(store, secret, env.PXLS_ALLOWED_ORIGINS ?? "");
    if (store.userCount() === 0) {
      const code = formatSetupCode();
      // Printed on purpose, and only here: this is how the person with access
      // to the server proves they own it.
      console.warn("No user accounts exist yet. Open pxls in your browser and finish setup.");
      console.warn(`One-time setup code (valid until an admin exists or the server restarts): ${code}`);
      service.setupCode = code;
    }
    return service;
  }

  /** For tests. */
  setSetupCode(code: string | null) {
    this.setupCode = code;
  }

  setupRequired(): boolean {
    return this.store.userCount() === 0;
  }

  // ---- setup -----------------------------------------------------------

  async setup(
    code: string,
    username: string,
    password: string,
    ip: string,
    userAgent: string | null,
  ): Promise<Result<Tokens, "bad-code" | "throttled" | "invalid">> {
    const now = nowSecs();
    const locked = this.store.throttleCheck("setup-ip", ip, now);
    if (locked) return { ok: false, error: "throttled", retryAfter: retryAfter(locked, now) };
    if (!this.setupCode || !constantTimeEq(code.trim(), this.setupCode)) {
      this.store.throttleFail("setup-ip", ip, now, SETUP_MAX_FAILURES, FAILURE_WINDOW_SECS, LOCK_SECS);
      security("setup rejected: bad or unavailable setup code", { ip });
      return { ok: false, error: "bad-code" };
    }
    const invalid = validateUsername(username) ?? validatePassword(password, username);
    if (invalid) return { ok: false, error: "invalid", message: invalid };
    const user = this.store.createFirstAdmin(username, await hashPassword(password), now);
    if (!user) return { ok: false, error: "bad-code" };
    this.setupCode = null;
    this.store.throttleClear("setup-ip", ip);
    security("first admin created", { ip, user: user.username });
    return { ok: true, value: await this.startSession(user, ip, userAgent, now) };
  }

  // ---- login / refresh -------------------------------------------------

  async login(
    username: string,
    password: string,
    ip: string,
    userAgent: string | null,
  ): Promise<Result<Tokens, "invalid" | "throttled">> {
    const now = nowSecs();
    const key = throttleKey(username);
    for (const [kind, k] of [
      ["login-ip", ip],
      ["login-user", key],
    ] as const) {
      const until = this.store.throttleCheck(kind, k, now);
      if (until) {
        security("login blocked: locked out", { ip, name: logKey(username) });
        return { ok: false, error: "throttled", retryAfter: retryAfter(until, now) };
      }
    }

    const found = this.store.findUserWithHash(username.trim());
    // Always one argon2 verify, against a dummy hash for unknown names.
    const passwordOk = await verifyPassword(found?.passwordHash ?? (await this.dummyHash), password);

    if (found && passwordOk && !found.user.disabled) {
      this.store.throttleClear("login-user", key);
      security("login succeeded", { ip, user: found.user.username });
      return { ok: true, value: await this.startSession(found.user, ip, userAgent, now) };
    }
    const userLocked = this.store.throttleFail("login-user", key, now, ACCOUNT_MAX_FAILURES, FAILURE_WINDOW_SECS, LOCK_SECS);
    const ipLocked = this.store.throttleFail("login-ip", ip, now, IP_MAX_FAILURES, FAILURE_WINDOW_SECS, LOCK_SECS);
    security("login failed", { ip, name: logKey(username), disabled: found?.user.disabled ?? false });
    if (userLocked || ipLocked) security("lockout started", { ip, name: logKey(username) });
    return { ok: false, error: "invalid" };
  }

  private async startSession(user: User, ip: string, userAgent: string | null, now: number): Promise<Tokens> {
    const sessionId = randomUUID();
    const refresh = randomToken();
    this.store.createSession({
      id: sessionId,
      userId: user.id,
      refreshHash: hashRefreshToken(refresh),
      now,
      idleTtl: REFRESH_IDLE_TTL_SECS,
      absoluteTtl: SESSION_MAX_SECS,
      userAgent: userAgent ? [...userAgent].slice(0, 200).join("") : null,
      ip,
    });
    return {
      accessToken: await this.issue(user.id, sessionId, now),
      expiresIn: ACCESS_TTL_SECS,
      user,
      refreshToken: refresh,
      refreshMaxAge: REFRESH_IDLE_TTL_SECS,
    };
  }

  /** Exchange a refresh token for a new access token and refresh token. */
  async refresh(presented: string, ip: string): Promise<Result<Tokens, "invalid">> {
    const now = nowSecs();
    const next = randomToken();
    const r = this.store.rotateSession(hashRefreshToken(presented), hashRefreshToken(next), now, REFRESH_IDLE_TTL_SECS);
    if (r.kind === "reuse") {
      security("refresh token reuse detected; session revoked", { ip, session: r.sessionId, user_id: r.userId });
      return { ok: false, error: "invalid" };
    }
    if (r.kind === "invalid") return { ok: false, error: "invalid" };
    const user = this.store.getUser(r.userId);
    if (!user) return { ok: false, error: "invalid" };
    return {
      ok: true,
      value: {
        accessToken: await this.issue(user.id, r.sessionId, now),
        expiresIn: ACCESS_TTL_SECS,
        user,
        refreshToken: next,
        refreshMaxAge: REFRESH_IDLE_TTL_SECS,
      },
    };
  }

  /** Revoke the session behind a refresh or browser token (logout). Quiet if unknown. */
  logoutToken(presented: string): void {
    const s = this.store.sessionForRefresh(hashRefreshToken(presented));
    if (s && this.store.revokeSession(s.userId, s.sessionId, nowSecs(), "logout")) {
      security("logout", { user_id: s.userId, session: s.sessionId });
    }
  }

  // ---- checks ----------------------------------------------------------

  async issue(userId: number, sessionId: string, now: number): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(String(userId))
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TTL_SECS)
      .sign(this.key);
  }

  /** Resolve a bearer token to a live session and an enabled user. */
  async authenticate(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        requiredClaims: ["exp", "sub"],
        clockTolerance: 0,
      });
      const uid = Number(payload.sub);
      const sid = typeof payload.sid === "string" ? payload.sid : null;
      if (!Number.isInteger(uid) || !sid) return null;
      const user = this.store.sessionUser(sid, uid, nowSecs());
      return user ? { user, sessionId: sid } : null;
    } catch {
      return null;
    }
  }

  /** Resolve a browser session cookie to a live session and an enabled user. */
  authenticateCookie(token: string): AuthUser | null {
    const r = this.store.touchCookieSession(hashRefreshToken(token), nowSecs(), REFRESH_IDLE_TTL_SECS);
    return r ? { user: r.user, sessionId: r.sessionId } : null;
  }

  // ---- passwords -------------------------------------------------------

  /** Change your own password. Revokes every session, including this one. */
  async changePassword(
    user: User,
    current: string,
    next: string,
    ip: string,
  ): Promise<Result<null, "wrong-current" | "throttled" | "invalid">> {
    const now = nowSecs();
    const key = String(user.id);
    const until = this.store.throttleCheck("password-user", key, now);
    if (until) return { ok: false, error: "throttled", retryAfter: retryAfter(until, now) };
    const invalid = validatePassword(next, user.username);
    if (invalid) return { ok: false, error: "invalid", message: invalid };
    const stored = this.store.userWithHashById(user.id);
    if (!stored || !(await verifyPassword(stored.passwordHash, current))) {
      this.store.throttleFail("password-user", key, now, ACCOUNT_MAX_FAILURES, FAILURE_WINDOW_SECS, LOCK_SECS);
      security("password change rejected: wrong current password", { ip, user: user.username });
      return { ok: false, error: "wrong-current" };
    }
    this.store.setPassword(user.id, await hashPassword(next), now);
    this.store.throttleClear("password-user", key);
    security("password changed; all sessions revoked", { ip, user: user.username });
    return { ok: true, value: null };
  }

  /** Admin sets a user's password. Revokes all of that user's sessions. */
  async adminSetPassword(target: User, next: string): Promise<Result<null, "invalid">> {
    const invalid = validatePassword(next, target.username);
    if (invalid) return { ok: false, error: "invalid", message: invalid };
    this.store.setPassword(target.id, await hashPassword(next), nowSecs());
    return { ok: true, value: null };
  }

  /** Create a user (admin). */
  async createUser(username: string, password: string, role: Role) {
    const invalid = validateUsername(username) ?? validatePassword(password, username);
    if (invalid) return { ok: false as const, message: invalid };
    const r = this.store.createUser(username, await hashPassword(password), role, nowSecs());
    return typeof r === "string" ? { ok: false as const, error: r } : { ok: true as const, user: r };
  }
}
