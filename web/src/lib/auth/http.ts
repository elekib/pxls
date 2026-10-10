// HTTP helpers for the API routes: JSON shapes, the CSRF header and the client IP.

import { isIP } from "node:net";

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "pxls";

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function error(status: number, message: string): Response {
  const r = json(status, { success: false, error: message });
  if (status === 401) r.headers.set("www-authenticate", "Bearer");
  return r;
}

function isPrivate(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) === 6) {
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return ip === "::1" || (first & 0xfe00) === 0xfc00;
  }
  return false;
}

/**
 * The client address for rate limits and logs: the real TCP peer (stamped by
 * peer.cjs). `X-Real-IP` is honoured only when the peer itself is private,
 * i.e. a reverse proxy on your network, never from a public peer.
 */
export function clientIp(headers: Headers): string {
  const peer = headers.get("x-pxls-peer")?.trim();
  if (!peer) return "unknown";
  if (isPrivate(peer)) {
    const real = headers.get("x-real-ip")?.trim();
    if (real && isIP(real)) return real;
  }
  return peer.startsWith("::ffff:") ? peer.slice(7) : peer;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
