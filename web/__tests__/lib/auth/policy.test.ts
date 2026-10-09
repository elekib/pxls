import { describe, expect, it } from "vitest";
import { isPublicPath, requiredRole } from "@/lib/auth/policy";

describe("policy", () => {
  it("keeps only health, Better Auth's own routes and the webhook receiver public", () => {
    for (const p of ["/api/health", "/api/auth/status", "/api/auth/sign-in/username", "/api/webhook/radarr"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/api/webhook-events", "/api/config", "/api/upload"]) expect(isPublicPath(p)).toBe(false);
  });

  it("gives viewers read access and admins everything else", () => {
    expect(requiredRole("GET", "/api/config")).toBe("viewer");
    expect(requiredRole("POST", "/api/config")).toBe("admin");
    expect(requiredRole("GET", "/api/uploads/a.png")).toBe("viewer");
    expect(requiredRole("GET", "/api/enhanced-webhooks")).toBe("admin");
    expect(requiredRole("GET", "/api/webhooks/x/rules")).toBe("admin");
    expect(requiredRole("POST", "/api/webhook-events/clear-all")).toBe("admin");
  });
});
