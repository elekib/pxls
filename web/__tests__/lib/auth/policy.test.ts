import { describe, expect, it } from "vitest";
import { isPublicPath, requiredRole } from "@/lib/auth/policy";

describe("policy", () => {
  it("keeps only the login flow, health and the webhook receiver public", () => {
    for (const p of ["/api/health", "/api/auth/login", "/api/auth/setup", "/api/webhook/radarr"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/api/webhook-events", "/api/auth/me", "/api/users", "/api/config"]) expect(isPublicPath(p)).toBe(false);
  });

  it("matches the Rust role policy", () => {
    expect(requiredRole("GET", "/api/config")).toBe("viewer");
    expect(requiredRole("POST", "/api/config")).toBe("admin");
    expect(requiredRole("GET", "/api/uploads/a.png")).toBe("viewer");
    expect(requiredRole("GET", "/api/enhanced-webhooks")).toBe("admin");
    expect(requiredRole("GET", "/api/webhooks/x/rules")).toBe("admin");
    expect(requiredRole("GET", "/api/users")).toBe("admin");
    expect(requiredRole("POST", "/api/auth/password")).toBe("viewer");
    expect(requiredRole("POST", "/api/webhook-events/clear-all")).toBe("admin");
  });
});
