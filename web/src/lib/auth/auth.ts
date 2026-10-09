// The Better Auth instance: usernames, roles, bearer tokens and rate limiting
// on pxls.db. Everything else in lib/auth is a thin layer over this.
//
// - Passwords: argon2id (m=19456, t=2, p=1).
// - Browser: `pxls_session` cookie (httpOnly, SameSite=Strict). Scripts: the
//   same session token as `Authorization: Bearer`, returned as the
//   `set-auth-token` header by sign-in.
// - Roles: "admin" or "viewer" (the default). "Disabled" is Better Auth's ban.
// - There is no self-registration; users are created by the setup flow
//   (first admin) and by admins.

import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, bearer, username } from "better-auth/plugins";
import type { Db } from "@/lib/db/sqlite";
import { MAX_PASSWORD_LEN, MAX_USERNAME_LEN, MIN_PASSWORD_LEN, MIN_USERNAME_LEN } from "./util";

export const SECRET_ENV = "PXLS_AUTH_SECRET";
export const MIN_SECRET_LEN = 32;
const SECRET_META_KEY = "auth_secret";

/** The header the route handler stamps with the real client address (see http.ts clientIp). */
export const IP_HEADER = "x-pxls-ip";

export const SESSION_TTL_SECS = 7 * 24 * 3600;

// algorithm 2 = Argon2id (Algorithm is a const enum, which isolatedModules cannot import).
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** PXLS_AUTH_SECRET, or a random key generated once and kept in the meta table. */
export function resolveSecret(db: Db, env: Record<string, string | undefined> = process.env): string {
  const given = env[SECRET_ENV]?.trim();
  if (given) {
    if (given.length < MIN_SECRET_LEN) throw new Error(`${SECRET_ENV} must be at least ${MIN_SECRET_LEN} characters`);
    return given;
  }
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(SECRET_META_KEY, randomBytes(32).toString("hex"));
  return (db.prepare("SELECT value FROM meta WHERE key = ?").get(SECRET_META_KEY) as { value: string }).value;
}

export interface AuthOptions {
  env?: Record<string, string | undefined>;
  /** Set the session cookie from server actions and components. Off in unit tests. */
  nextCookies?: boolean;
}

export function createAuth(db: Db, opts: AuthOptions = {}) {
  const env = opts.env ?? process.env;
  const origins = (env.PXLS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return betterAuth({
    appName: "pxls",
    database: db,
    secret: resolveSecret(db, env),
    baseURL: env.PXLS_BASE_URL?.trim() || undefined,
    trustedOrigins: origins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LEN,
      maxPasswordLength: MAX_PASSWORD_LEN,
      password: { hash: hashPassword, verify: ({ hash: h, password }) => verifyPassword(h, password) },
    },
    session: { expiresIn: SESSION_TTL_SECS, updateAge: 3600 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/username": { window: 15 * 60, max: 10 },
        "/change-password": { window: 15 * 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "pxls",
      useSecureCookies: env.PXLS_COOKIE_SECURE?.toLowerCase() === "true" ? true : undefined,
      defaultCookieAttributes: { sameSite: "strict", httpOnly: true },
      ipAddress: { ipAddressHeaders: [IP_HEADER] },
    },
    plugins: [
      username({ minUsernameLength: MIN_USERNAME_LEN, maxUsernameLength: MAX_USERNAME_LEN }),
      admin({ defaultRole: "viewer", bannedUserMessage: "Invalid username or password" }),
      bearer(),
      ...(opts.nextCookies === false ? [] : [nextCookies()]),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
