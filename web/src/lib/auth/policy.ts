// Which role a route needs. `/api/auth/*` belongs to Better Auth (see
// app/api/auth/[...all]/route.ts), which checks its own sessions and roles.

import type { Role } from "./accounts";

/** Routes that need no session. */
export function isPublicPath(path: string): boolean {
  return path === "/api/health" || path === "/api/auth/status" || path.startsWith("/api/auth/") || path.startsWith("/api/webhook/");
}

/**
 * The least-privileged role allowed to call a (non-public) route. Viewers get
 * read-only access; anything that changes state or exposes webhook secrets is
 * admin only.
 */
export function requiredRole(method: string, path: string): Role {
  if (method !== "GET" && method !== "HEAD") return "admin";
  if (path === "/api/enhanced-webhooks" || path.startsWith("/api/enhanced-webhooks/") || path.startsWith("/api/webhooks/")) {
    return "admin";
  }
  return "viewer";
}
