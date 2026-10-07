// Beszel (PocketBase) hub access for the System, GPU and Temps pages.
// Port of token_manager.rs and pages/beszel.rs: the app logs in with the
// configured credentials, keeps the token in memory only, renews it before
// expiry, throttles logins, and caches system-name lookups.

import type { Config } from "@/lib/config/model";

const RENEW_BEFORE_EXPIRY_SECS = 3600;
const MIN_LOGIN_INTERVAL_MS = 30_000;
const MIN_TOKEN_AGE_FOR_FORCED_RELOGIN_MS = 300_000;
const LOGIN_TIMEOUT_MS = 5000;
export const REQUEST_TIMEOUT_MS = 5000;
const SYSTEM_CACHE_TTL_MS = 600_000;

const nowSecs = () => Math.floor(Date.now() / 1000);

/** Read the `exp` claim of a JWT without verifying it. */
export function parseJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const exp = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** POST /api/collections/users/auth-with-password. Never logs the password. */
export async function beszelLogin(hubUrl: string, email: string, password: string, fetchFn = fetch): Promise<string> {
  let r: Response;
  try {
    r = await fetchFn(`${hubUrl.replace(/\/+$/, "")}/api/collections/users/auth-with-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Could not reach the hub: ${(e as Error).message}`);
  }
  if (r.ok) {
    const body = (await r.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token === "string") return body.token;
    throw new Error("Unexpected login response");
  }
  if (r.status === 400 || r.status === 401) throw new Error(`Invalid email or password (${r.status})`);
  if (r.status === 429) throw new Error("Hub is rate limiting logins (429), will retry later");
  const msg = ((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? "";
  throw new Error(`Hub returned ${r.status} ${msg}`.trim());
}

export interface BeszelStatus {
  configured: boolean;
  mode: "credentials" | "legacy_token" | "none";
  logged_in: boolean;
  token_expires: number | null;
  last_error: string | null;
}

/** Provides a valid Beszel token. Port of TokenManager. */
export class TokenManager {
  private token: string | null = null;
  private exp: number | null = null;
  private loggedInAt: number | null = null;
  private lastAttempt: number | null = null;
  private lastError: string | null = null;
  private busy: Promise<string | null> | null = null;

  constructor(
    private readonly config: () => Config,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Current token, logging in first if there is none or it is about to expire. */
  async getToken(): Promise<string | null> {
    if (this.token && !needsRenewal(this.exp)) return this.token;
    const creds = this.credentials();
    if (!creds) return this.legacyToken();
    if (this.throttled()) return this.unexpired();
    return this.login(creds);
  }

  /** After a failed request: drop the token and log in again (throttled). */
  async refreshToken(): Promise<string | null> {
    const creds = this.credentials();
    if (!creds) return this.legacyToken();
    if (this.throttled() || this.fresh()) return this.unexpired();
    this.token = null;
    this.exp = null;
    return this.login(creds);
  }

  /** Forget the token and backoff, e.g. after the credentials change. */
  invalidate(): void {
    this.token = this.exp = this.loggedInAt = this.lastAttempt = null;
    this.lastError = null;
  }

  status(): BeszelStatus {
    const creds = this.credentials();
    const legacy = creds ? null : this.legacyToken();
    const mode = creds ? "credentials" : legacy ? "legacy_token" : "none";
    let loggedIn = false;
    let expires: number | null = null;
    if (creds && this.token) {
      loggedIn = !isExpired(this.exp);
      expires = this.exp;
    } else if (!creds && legacy) {
      expires = parseJwtExp(legacy);
      loggedIn = !isExpired(expires);
    }
    return { configured: mode !== "none", mode, logged_in: loggedIn, token_expires: expires, last_error: this.lastError };
  }

  /** Try a login without touching the cached token ("Test login"). */
  async testLogin(email: string, password: string): Promise<void> {
    const hub = this.hubUrl();
    if (!hub) throw new Error("No Beszel page is configured yet, so there is no hub URL to test against");
    await beszelLogin(hub, email, password, this.fetchFn);
  }

  private async login(creds: { email: string; password: string }): Promise<string | null> {
    // One login at a time; concurrent renders share it.
    this.busy ??= (async () => {
      this.lastAttempt = Date.now();
      const hub = this.hubUrl();
      if (!hub) {
        this.lastError = "No Beszel page configured, no hub URL";
        return null;
      }
      try {
        const token = await beszelLogin(hub, creds.email, creds.password, this.fetchFn);
        this.token = token;
        this.exp = parseJwtExp(token);
        this.loggedInAt = Date.now();
        this.lastError = null;
        console.log("[beszel] logged in");
        return token;
      } catch (e) {
        this.lastError = (e as Error).message;
        console.warn(`[beszel] login failed: ${this.lastError}`);
        return this.unexpired();
      }
    })().finally(() => (this.busy = null));
    return this.busy;
  }

  private throttled = () => this.lastAttempt !== null && Date.now() - this.lastAttempt < MIN_LOGIN_INTERVAL_MS;
  private fresh = () => !!this.token && this.loggedInAt !== null && Date.now() - this.loggedInAt < MIN_TOKEN_AGE_FOR_FORCED_RELOGIN_MS;
  private unexpired = () => (this.token && !isExpired(this.exp) ? this.token : null);

  private credentials(): { email: string; password: string } | null {
    const a = this.config().beszel_auth;
    if (!a || !a.email.trim() || !a.password) return null;
    return { email: a.email.trim(), password: a.password };
  }

  private legacyToken(): string | null {
    const t = this.config().beszel_token?.auth_token ?? "";
    return t && !isExpired(parseJwtExp(t)) ? t : null;
  }

  /** The hub of the first page that uses Beszel (all pages share one hub). */
  hubUrl(): string | null {
    for (const p of this.config().custom_pages as { page_type?: { type?: string; beszel_hub_url?: string | null } }[]) {
      const t = p?.page_type;
      if (t && ["SystemStats", "GpuStats", "Temps"].includes(t.type ?? "") && t.beszel_hub_url?.trim()) return t.beszel_hub_url;
    }
    return null;
  }
}

const needsRenewal = (exp: number | null) => exp === null || nowSecs() >= exp - RENEW_BEFORE_EXPIRY_SECS;
const isExpired = (exp: number | null) => exp !== null && nowSecs() >= exp;

// ---- system lookup -----------------------------------------------------

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** GET a hub URL as JSON, with the token if there is one. */
export async function hubGet(url: string, token: string | null, fetchFn: typeof fetch = fetch): Promise<unknown> {
  const r = await fetchFn(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new HttpError(r.status);
  return r.json();
}

const systemCache = new Map<string, { id: string; at: number }>();

const cacheKey = (hub: string, name: string | null) => `${hub.replace(/\/+$/, "")}|${name === null ? "*" : name.trim().toLowerCase()}`;

/** Exact name first, then case-insensitive; with no name, the first system. */
export function pickSystem(items: { id: string; name?: string | null }[], name: string | null): string | null {
  if (name === null) return items[0]?.id ?? null;
  const exact = items.find((s) => s.name === name);
  if (exact) return exact.id;
  const lower = name.toLowerCase();
  return items.find((s) => s.name?.toLowerCase() === lower)?.id ?? null;
}

/** A 404 for a resolved system means its cached ID is stale. */
export function noteFailure(hub: string, requested: string | null, e: unknown) {
  if (e instanceof HttpError && e.status === 404) systemCache.delete(cacheKey(hub, requested));
}

export function clearSystemCache() {
  systemCache.clear();
}

/** Resolve a system ID from its name (or the first system). Cached for 10 min. */
export async function resolveSystemId(hub: string, name: string | null, tm: TokenManager | null, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const key = cacheKey(hub, name);
  const hit = systemCache.get(key);
  if (hit && Date.now() - hit.at < SYSTEM_CACHE_TTL_MS) return hit.id;

  const lookup = async (token: string | null) => {
    const base = hub.replace(/\/+$/, "");
    const url =
      name === null
        ? `${base}/api/collections/systems/records?perPage=1`
        : `${base}/api/collections/systems/records?filter=${encodeURIComponent(`name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)}`;
    const data = (await hubGet(url, token, fetchFn)) as { items?: { id: string; name?: string }[] };
    const id = pickSystem(data.items ?? [], name);
    if (!id) throw new Error(name === null ? "No systems found" : `System '${name}' not found`);
    return id;
  };

  let id: string | null = null;
  try {
    id = await lookup(tm ? await tm.getToken() : null);
  } catch {
    const t = tm ? await tm.refreshToken() : null;
    if (t) id = await lookup(t).catch(() => null);
  }
  if (id) systemCache.set(key, { id, at: Date.now() });
  return id;
}

/** IDs are 15 alphanumerics; anything else is treated as a system name. */
export const looksLikeName = (id: string) => id.length < 15 || !/^[A-Za-z0-9]+$/.test(id);

/**
 * The hub's system record for a page, retrying once with a fresh login after
 * a 401/403. Null when unreachable or unknown.
 */
export async function fetchSystemRecord(
  hub: string,
  systemId: string | null,
  tm: TokenManager | null,
  fetchFn: typeof fetch = fetch,
): Promise<{ id: string; record: Record<string, unknown>; token: string | null } | null> {
  const attempt = async (token: string | null) => {
    const requested = systemId;
    const id =
      systemId && !looksLikeName(systemId) ? systemId : await resolveSystemId(hub, systemId, tm, fetchFn);
    if (!id) return null;
    try {
      const record = (await hubGet(`${hub}/api/collections/systems/records/${id}`, token, fetchFn)) as Record<string, unknown>;
      return { id, record, token };
    } catch (e) {
      noteFailure(hub, requested, e);
      throw e;
    }
  };
  try {
    return await attempt(tm ? await tm.getToken() : null);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403) && tm) {
      const t = await tm.refreshToken();
      if (t) return attempt(t).catch(() => null);
    }
    return null;
  }
}
