// Account session handling: the access token lives only in memory; the refresh
// token is an httpOnly cookie the browser sends to /api/auth. apiFetch() attaches
// the access token, refreshes it silently shortly before it expires (or after a
// 401), and tells the app when the session is really over.

export const AUTH_REQUIRED_EVENT = 'pxls-auth-required';
export const FORBIDDEN_EVENT = 'pxls-forbidden';

export type Role = 'admin' | 'viewer';

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: number;
  password_changed_at: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

// Sent on every call that uses the cookie or credentials. Browsers cannot attach a
// custom header to a cross-site form post, which is what blocks CSRF.
const CSRF = { 'X-Requested-With': 'pxls' };
const REFRESH_MARGIN_MS = 60_000;

let accessToken: string | null = null;
let expiresAt = 0;
let refreshTimer: number | undefined;
let inflight: Promise<User | null> | null = null;
const listeners = new Set<(user: User | null) => void>();
let currentUser: User | null = null;

export function getUser(): User | null {
  return currentUser;
}

/** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
export function onUserChange(fn: (user: User | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSession(token: TokenResponse | null) {
  window.clearTimeout(refreshTimer);
  if (token) {
    accessToken = token.access_token;
    expiresAt = Date.now() + token.expires_in * 1000;
    currentUser = token.user;
    refreshTimer = window.setTimeout(
      () => void refreshSession(true),
      Math.max(token.expires_in * 1000 - REFRESH_MARGIN_MS, 5_000),
    );
  } else {
    accessToken = null;
    expiresAt = 0;
    currentUser = null;
  }
  listeners.forEach((fn) => fn(currentUser));
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? CSRF : { ...CSRF, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Run `fn` while holding a cross-tab lock, so two tabs never rotate the same refresh token at once. */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request('pxls-refresh', fn) : fn();
}

/**
 * Get a fresh access token using the refresh cookie. Resolves to the user, or null
 * if there is no valid session. Concurrent callers share one request.
 * `announce` fires the "session expired" event on failure (used once signed in).
 */
export function refreshSession(announce = false): Promise<User | null> {
  if (!inflight) {
    inflight = withRefreshLock(async () => {
      try {
        const r = await post('/api/auth/refresh');
        if (r.ok) {
          const t = (await r.json()) as TokenResponse;
          setSession(t);
          return t.user;
        }
        if (r.status === 401 || r.status === 403) {
          const wasSignedIn = currentUser !== null;
          setSession(null);
          if (announce || wasSignedIn) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
        }
      } catch {
        // Network trouble: keep the current token; the next call retries.
      }
      return null;
    }).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export interface AuthStatus {
  setup_required: boolean;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const r = await fetch('/api/auth/status');
  if (!r.ok) throw new Error('Could not reach the server');
  return r.json();
}

export class AuthError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function tokenCall(path: string, body: unknown): Promise<User> {
  const r = await post(path, body);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const retry = Number(r.headers.get('Retry-After')) || undefined;
    throw new AuthError(data.error || 'Request failed', r.status, retry);
  }
  setSession(data as TokenResponse);
  return (data as TokenResponse).user;
}

export const login = (username: string, password: string) =>
  tokenCall('/api/auth/login', { username, password });

export const completeSetup = (setup_code: string, username: string, password: string) =>
  tokenCall('/api/auth/setup', { setup_code, username, password });

export async function logout(): Promise<void> {
  try {
    await post('/api/auth/logout');
  } catch {
    // The local session is dropped either way.
  }
  setSession(null);
}

/** Drop the local session without calling the server (it is already gone there). */
export function endLocalSession(): void {
  setSession(null);
}

/** fetch() with the access token attached. Refreshes it when needed; a lost session sends the user to sign in. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!accessToken || Date.now() > expiresAt - 10_000) await refreshSession();

  const send = () => {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
  };

  let response = await send();
  if (response.status === 401 && currentUser) {
    // The token may have been revoked or rotated away; one silent retry.
    if (await refreshSession(true)) response = await send();
  }
  if (response.status === 403) window.dispatchEvent(new Event(FORBIDDEN_EVENT));
  return response;
}

/** JSON helper for the account and admin endpoints. Throws Error with the server's message. */
export async function accountRequest<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { ...CSRF, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data as T;
}
