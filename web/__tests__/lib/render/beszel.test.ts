import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "@/lib/config/model";
import { TokenManager, clearSystemCache, fetchSystemRecord, looksLikeName, parseJwtExp, pickSystem, resolveSystemId } from "@/lib/render/beszel";

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
const HUB = "http://hub";
const cfg = (auth: object | null = { email: "me@x", password: "pw" }) =>
  normalizeConfig({ beszel_auth: auth, custom_pages: [{ name: "s", enabled: true, page_type: { type: "SystemStats", source: "beszel", beszel_hub_url: HUB } }] });

/** A fake hub: login, list systems, read a record. */
function hub(opts: { loginStatus?: number; recordStatus?: number[] } = {}) {
  const calls: string[] = [];
  const recordStatus = [...(opts.recordStatus ?? [])];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u.replace(HUB, "")}`);
    if (u.includes("auth-with-password")) {
      return opts.loginStatus ? new Response("{}", { status: opts.loginStatus }) : Response.json({ token: jwt(Math.floor(Date.now() / 1000) + 86400) });
    }
    if (u.includes("/records?")) return Response.json({ items: [{ id: "abcdefghijklmno", name: "Stark" }] });
    const s = recordStatus.shift() ?? 200;
    return s === 200 ? Response.json({ id: "abcdefghijklmno", info: { cpu: 12.4, mp: 50.6 } }) : new Response("", { status: s });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("lookups", () => {
  it("picks exact names, then case-insensitive, then the first", () => {
    const items = [{ id: "1", name: "stark" }, { id: "2", name: "Stark" }];
    expect(pickSystem(items, "Stark")).toBe("2");
    expect(pickSystem(items, "STARK")).toBe("1");
    expect(pickSystem(items, "missing")).toBeNull();
    expect(pickSystem(items, null)).toBe("1");
    expect(pickSystem([], null)).toBeNull();
  });

  it("treats short or non-alphanumeric ids as names", () => {
    expect(looksLikeName("Stark")).toBe(true);
    expect(looksLikeName("abcdefghijklmno")).toBe(false);
    expect(looksLikeName("abcdefghijklm-o")).toBe(true);
  });

  it("caches resolved ids and escapes quotes in the filter", async () => {
    clearSystemCache();
    const h = hub();
    expect(await resolveSystemId(HUB, "Stark", null, h.fn)).toBe("abcdefghijklmno");
    expect(await resolveSystemId(HUB, "stark ", null, h.fn)).toBe("abcdefghijklmno");
    expect(h.calls).toHaveLength(1);
    await resolveSystemId(HUB, "it's", null, h.fn);
    expect(decodeURIComponent(h.calls[1]!)).toContain("name='it\\'s'");
  });
});

describe("TokenManager", () => {
  it("parses exp and rejects malformed tokens", () => {
    expect(parseJwtExp(jwt(1789594176))).toBe(1789594176);
    expect(parseJwtExp("not-a-jwt")).toBeNull();
    expect(parseJwtExp("a.!!!.c")).toBeNull();
  });

  it("logs in once, reuses the token and throttles failed logins", async () => {
    const h = hub();
    const tm = new TokenManager(() => cfg(), h.fn);
    const t = await tm.getToken();
    expect(t).toBeTruthy();
    expect(await tm.getToken()).toBe(t);
    expect(tm.status()).toMatchObject({ configured: true, mode: "credentials", logged_in: true, last_error: null });

    const bad = hub({ loginStatus: 401 });
    const tm2 = new TokenManager(() => cfg(), bad.fn);
    expect(await tm2.getToken()).toBeNull();
    expect(await tm2.getToken()).toBeNull();
    expect(bad.calls.filter((c) => c.includes("auth"))).toHaveLength(1);
    expect(tm2.status().last_error).toBe("Invalid email or password (401)");
  });

  it("has no token without credentials and never fetches", async () => {
    const h = hub();
    const tm = new TokenManager(() => cfg(null), h.fn);
    expect(await tm.getToken()).toBeNull();
    expect(await tm.refreshToken()).toBeNull();
    expect(tm.status().configured).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it("retries a 401 record read once with a fresh login", async () => {
    clearSystemCache();
    const h = hub({ recordStatus: [401, 200] });
    const tm = new TokenManager(() => cfg(), h.fn);
    // Pretend the token is old enough to be replaced.
    (tm as unknown as { loggedInAt: number }).loggedInAt = 0;
    const r = await fetchSystemRecord(HUB, "abcdefghijklmno", tm, h.fn);
    expect(r?.record).toMatchObject({ info: { cpu: 12.4 } });
  });
});
