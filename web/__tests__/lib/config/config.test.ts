import { describe, expect, it } from "vitest";
import { defaultConfig, hexToRgb, normalizeConfig, pickKnown } from "@/lib/config/model";
import { loadConfig, preserveSecrets, publicConfig, saveConfig } from "@/lib/config/store";
import { openMemoryDb } from "@/lib/db/sqlite";

describe("config model", () => {
  it("writes the Rust defaults on first load and round-trips", () => {
    const db = openMemoryDb();
    const cfg = loadConfig(db);
    expect(cfg).toEqual(defaultConfig());
    cfg.timezone = "Europe/London";
    saveConfig(db, cfg);
    expect(loadConfig(db).timezone).toBe("Europe/London");
  });

  it("gives missing fields serde zero values and keeps unknown fields", () => {
    const cfg = normalizeConfig({ pixoo_mac: "AA", future_field: { x: 1 }, device_config: { brightness: 70 } });
    expect(cfg.device_config).toMatchObject({ brightness: 70, light_mode: "", time_format: "" });
    expect(cfg.device_config.light_config).toEqual({ color: [0, 0, 0], brightness: 0, effect_mode: 0, on: false });
    expect(cfg.future_field).toEqual({ x: 1 });
    expect(cfg.custom_pages).toEqual([]);
    expect(cfg.beszel_auth).toBeNull();
  });

  it("clamps out-of-range numbers instead of failing to load", () => {
    const cfg = normalizeConfig({ device_config: { brightness: 250, score_config: { red_score: 5000, blue_score: -3 }, light_config: { color: "bad" } } });
    expect(cfg.device_config.brightness).toBe(100);
    expect(cfg.device_config.score_config).toEqual({ red_score: 999, blue_score: 0 });
    expect(cfg.device_config.light_config.color).toEqual([0, 0, 0]);
  });

  it("only accepts known top-level fields from clients", () => {
    expect(Object.keys(pickKnown({ timezone: "x", evil: 1, device_config: {} }))).toEqual(["timezone", "device_config"]);
  });

  it("parses hex colors", () => {
    expect(hexToRgb("#00FFFF")).toEqual([0, 255, 255]);
    expect(hexToRgb("FFA500")).toEqual([255, 165, 0]);
    expect(hexToRgb("nope")).toEqual([255, 255, 255]);
  });
});

describe("secrets", () => {
  const stored = () =>
    normalizeConfig({ beszel_auth: { email: "a@b.c", password: "s3cret" }, beszel_token: { auth_token: "tok", last_refresh: 1 } });

  it("never sends secrets to the browser", () => {
    const pub = publicConfig(stored());
    expect(pub.beszel_auth).toEqual({ email: "a@b.c", password: "", password_set: true });
    expect(pub).not.toHaveProperty("beszel_token");
    expect(JSON.stringify(pub)).not.toContain("s3cret");
    expect(JSON.stringify(pub)).not.toContain("tok");
  });

  it("keeps the stored password when the browser sends it blank", () => {
    const incoming = normalizeConfig({ beszel_auth: { email: " a@b.c ", password: "" } });
    expect(preserveSecrets(incoming, stored(), true)).toBe(false);
    expect(incoming.beszel_auth).toEqual({ email: "a@b.c", password: "s3cret" });
    expect(incoming.beszel_token).toBeUndefined();
  });

  it("keeps the login when an old client omits it, and clears it on empty email", () => {
    const old = normalizeConfig({});
    preserveSecrets(old, stored(), false);
    expect(old.beszel_auth?.password).toBe("s3cret");
    const cleared = normalizeConfig({ beszel_auth: { email: "", password: "" } });
    expect(preserveSecrets(cleared, stored(), true)).toBe(true);
    expect(cleared.beszel_auth).toBeNull();
    expect(cleared.beszel_token).toEqual({ auth_token: "tok", last_refresh: 1 });
  });
});
