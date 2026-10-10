// Same signature as the original UI's apiFetch, for screens ported from it.
// The browser session cookie authenticates; state changes carry the CSRF
// header the API requires. 401 means the session ended; 403 means read-only.

export const FORBIDDEN_EVENT = "pxls:forbidden";

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") headers.set("x-requested-with", "pxls");
  const response = await fetch(input, { ...init, headers, credentials: "same-origin" });
  if (response.status === 401) window.location.href = "/login";
  if (response.status === 403) window.dispatchEvent(new Event(FORBIDDEN_EVENT));
  return response;
}

/** JSON helper with the original UI's signature. Throws Error with the server's message. */
export async function accountRequest<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || response.statusText);
  return data as T;
}
