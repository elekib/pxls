// Which role a route needs. Port of auth.rs `is_public_path` / `required_role`.

import type { Role } from "./store";

/** Routes that need no access token. */
export function isPublicPath(path: string): boolean {
  return (
    ["/api/health", "/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(
      path,
    ) || path.startsWith("/api/webhook/")
  );
}

/**
 * The least-privileged role allowed to call a (non-public) route. Viewers get
 * read-only access; anything that changes state, manages users or exposes
 * webhook secrets is admin only.
 */
export function requiredRole(method: string, path: string): Role {
  if (path === "/api/users" || path.startsWith("/api/users/")) return "admin";
  if (path.startsWith("/api/auth/")) return "viewer";
  if (method !== "GET" && method !== "HEAD") return "admin";
  if (path === "/api/enhanced-webhooks" || path.startsWith("/api/enhanced-webhooks/") || path.startsWith("/api/webhooks/")) {
    return "admin";
  }
  return "viewer";
}
