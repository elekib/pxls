// API token storage and an authenticated fetch wrapper.

const STORAGE_KEY = 'pxls.apiToken';
export const AUTH_REQUIRED_EVENT = 'pxls-auth-required';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // storage unavailable: the token only lasts for this page load
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** fetch() with the stored API token attached. A 401 sends the user back to the login screen. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  return response;
}

/** Check a token against the API without storing it. */
export async function verifyToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/connection-status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
