import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// auth.ts keeps session state at module level, so load a fresh copy per test.
async function loadAuth() {
  vi.resetModules();
  return import('./auth');
}

const user = {
  id: 1, username: 'admin', role: 'admin' as const, disabled: false, created_at: 0, password_changed_at: 0,
};
const token = (extra = {}) => ({ access_token: 'tok-1', expires_in: 900, user, ...extra });
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('login', () => {
  it('stores the user, notifies listeners and sends the CSRF header', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    const seen: unknown[] = [];
    auth.onUserChange((u) => seen.push(u));

    expect(await auth.login('admin', 'pw')).toEqual(user);
    expect(auth.getUser()).toEqual(user);
    expect(seen).toEqual([user]);

    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/auth/login');
    expect(init.headers['X-Requested-With']).toBe('pxls');
    expect(JSON.parse(init.body)).toEqual({ username: 'admin', password: 'pw' });
  });

  it('throws AuthError with status and Retry-After on failure', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(429, { error: 'slow down' }, { 'Retry-After': '30' }));
    const err = await auth.login('admin', 'bad').catch((e) => e);
    expect(err).toBeInstanceOf(auth.AuthError);
    expect(err.message).toBe('slow down');
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(30);
    expect(auth.getUser()).toBeNull();
  });
});

describe('onUserChange', () => {
  it('stops notifying after unsubscribe', async () => {
    const auth = await loadAuth();
    const fn = vi.fn();
    const off = auth.onUserChange(fn);
    off();
    auth.endLocalSession();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('drops the local session even if the request fails', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await auth.logout();
    expect(auth.getUser()).toBeNull();
  });
});

describe('refreshSession', () => {
  it('shares one request between concurrent callers', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(reply(200, token()));
    const [a, b] = await Promise.all([auth.refreshSession(), auth.refreshSession()]);
    expect(a).toEqual(user);
    expect(b).toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('announces a lost session when a signed-in user is rejected', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    const onRequired = vi.fn();
    window.addEventListener(auth.AUTH_REQUIRED_EVENT, onRequired);

    fetchMock.mockResolvedValueOnce(reply(401));
    expect(await auth.refreshSession()).toBeNull();
    expect(auth.getUser()).toBeNull();
    expect(onRequired).toHaveBeenCalledTimes(1);
    window.removeEventListener(auth.AUTH_REQUIRED_EVENT, onRequired);
  });

  it('stays quiet for a visitor who was never signed in', async () => {
    const auth = await loadAuth();
    const onRequired = vi.fn();
    window.addEventListener(auth.AUTH_REQUIRED_EVENT, onRequired);
    fetchMock.mockResolvedValueOnce(reply(401));
    expect(await auth.refreshSession()).toBeNull();
    expect(onRequired).not.toHaveBeenCalled();
    window.removeEventListener(auth.AUTH_REQUIRED_EVENT, onRequired);
  });

  it('keeps the session on network errors', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await auth.refreshSession()).toBeNull();
    expect(auth.getUser()).toEqual(user);
  });

  it('refreshes automatically a minute before the token expires', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token({ expires_in: 120 })));
    await auth.login('admin', 'pw');
    fetchMock.mockResolvedValueOnce(reply(200, token({ access_token: 'tok-2' })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
  });
});

describe('apiFetch', () => {
  it('attaches the bearer token', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await auth.apiFetch('/api/config');
    const init = fetchMock.mock.calls[1][1];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1');
  });

  it('refreshes first when there is no token yet', async () => {
    const auth = await loadAuth();
    fetchMock
      .mockResolvedValueOnce(reply(200, token()))
      .mockResolvedValueOnce(reply(200, {}));
    await auth.apiFetch('/api/config');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/config');
  });

  it('retries once with a new token after a 401', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    fetchMock
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200, token({ access_token: 'tok-2' })))
      .mockResolvedValueOnce(reply(200, { ok: true }));
    const response = await auth.apiFetch('/api/config');
    expect(response.status).toBe(200);
    const retry = fetchMock.mock.calls[3][1];
    expect(new Headers(retry.headers).get('Authorization')).toBe('Bearer tok-2');
  });

  it('raises the forbidden event on 403', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    const onForbidden = vi.fn();
    window.addEventListener(auth.FORBIDDEN_EVENT, onForbidden);
    fetchMock.mockResolvedValueOnce(reply(403));
    await auth.apiFetch('/api/users');
    expect(onForbidden).toHaveBeenCalledTimes(1);
    window.removeEventListener(auth.FORBIDDEN_EVENT, onForbidden);
  });
});

describe('accountRequest', () => {
  it('returns parsed JSON and throws the server message on errors', async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValueOnce(reply(200, token()));
    await auth.login('admin', 'pw');
    fetchMock.mockResolvedValueOnce(reply(200, { users: [] }));
    expect(await auth.accountRequest('/api/users')).toEqual({ users: [] });
    fetchMock.mockResolvedValueOnce(reply(400, { error: 'password too short' }));
    await expect(auth.accountRequest('/api/account/password', 'POST', { p: 'x' })).rejects.toThrow(
      'password too short',
    );
  });
});
