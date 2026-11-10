import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | object,
  device: "connected" as string,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
vi.mock("@/lib/auth/api", () => ({
  requireApi: async () => (state.session ? { user: { role: "viewer" } } : Response.json({ error: "Unauthorized" }, { status: 401 })),
}));
vi.mock("@/lib/version", () => ({ version: () => "0.1.0", revision: () => "abc1234" }));
vi.mock("@/lib/engine/engine", () => ({
  getEngine: () => ({
    getStatus: () => ({
      device: state.device,
      error: state.device === "connected" ? null : "timed out after 20s connecting to 11:22:33:44:55:66",
      connectedAt: null,
      mac: "11:22:33:44:55:66",
      manualDisconnect: false,
      failingSince: state.device === "connected" ? null : "2026-11-08T16:04:00.000Z",
      failedAttempts: state.device === "connected" ? 0 : 7,
    }),
    linkHealth: () => ({ retryDelayMs: 2000, consecutiveTimeouts: 0, abandoned: 0 }),
  }),
}));

import { GET } from "@/app/api/health/route";

const get = (q = "") => GET(new Request(`http://pxls.test/api/health${q}`));

beforeEach(() => {
  state.session = null;
  state.device = "connected";
});

describe("GET /api/health", () => {
  it("stays {status: ok} for the container healthcheck, even with the device down", async () => {
    state.device = "error";
    const r = await get();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
  });

  it("does not show device state to anonymous callers", async () => {
    state.device = "error";
    const r = await get("?device=1");
    expect(r.status).toBe(401);
  });

  it("answers 503 with the link state when the device is down", async () => {
    state.session = {};
    state.device = "error";
    const r = await get("?device=1");
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({
      status: "unavailable",
      device: "error",
      failingSince: "2026-11-08T16:04:00.000Z",
      failedAttempts: 7,
      link: { abandoned: 0 },
    });
  });

  it("answers 200 when the device is connected", async () => {
    state.session = {};
    const r = await get("?device=1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "ok", device: "connected" });
  });
});
