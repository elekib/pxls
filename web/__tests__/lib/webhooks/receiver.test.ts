import { describe, expect, it, vi } from "vitest";
import { openMemoryDb } from "@/lib/db/sqlite";
import type { ActionContext } from "@/lib/webhooks/actions";
import { parseWebhook } from "@/lib/webhooks/model";
import { NotificationManager, renderNotification, iconCode, firstWord } from "@/lib/webhooks/notifications";
import { extractWebhookSecret, ingestWebhook, webhookSecretOk } from "@/lib/webhooks/receiver";
import { ensureSecrets, loadWebhooks, logEvent, recentEvents, replaceWebhooks, MAX_TOTAL_EVENTS } from "@/lib/webhooks/store";

function setup(overrides: object = {}) {
  const db = openMemoryDb();
  const hook = parseWebhook({
    name: "radarr", path: "radarr", secret: "fixture-secret-radarr-123", enabled: true, log_events: true, max_events: 2,
    display_mode: "text", title_field: "movie.title", subtitle_field: "", background_color: "000000", text_color: "FFFFFF",
    rules: [{ id: "r1", name: "Grabbed", enabled: true, conditions: [{ field_path: "eventType", operator: "Equals", value: "Grab", case_insensitive: false }], actions: [{ action_type: "DisplayNotification", parameters: { title: "GRAB {movie.title}" } }], condition_logic: "All" }],
    ...overrides,
  });
  replaceWebhooks(db, [hook]);
  const notifications = new NotificationManager();
  const buzz = vi.fn(async () => {});
  const ctx: ActionContext = { notifications, buzzer: buzz };
  return { db, ctx, notifications, buzz };
}

describe("webhook secrets", () => {
  it("reads the header, Basic auth password or ?secret=", () => {
    expect(extractWebhookSecret(new Headers({ "x-webhook-secret": " s1 " }), "")).toBe("s1");
    const basic = Buffer.from("radarr:s2").toString("base64");
    expect(extractWebhookSecret(new Headers({ authorization: `Basic ${basic}` }), "")).toBe("s2");
    expect(extractWebhookSecret(new Headers(), "?a=1&secret=from%20query&b=2")).toBe("from query");
    expect(extractWebhookSecret(new Headers(), "?a=1")).toBeNull();
  });

  it("fails closed without a configured secret", () => {
    expect(webhookSecretOk("fixture-secret-abcdefgh", "fixture-secret-abcdefgh")).toBe(true);
    expect(webhookSecretOk("fixture-secret-abcdefgh", "fixture-secret-abcdefgX")).toBe(false);
    expect(webhookSecretOk("", "")).toBe(false);
    expect(webhookSecretOk("fixture-secret-abcdefgh", null)).toBe(false);
  });
});

describe("processing", () => {
  it("runs the first matching rule and logs the event", async () => {
    const { db, ctx, notifications } = setup();
    const r = await ingestWebhook(db, "radarr", { eventType: "Grab", movie: { title: "Dune" } }, ctx);
    expect(r).toMatchObject({ status: 200, body: { success: true, processed: true, matched_rule: "Grabbed", actions_taken: ["Displayed notification: GRAB Dune"] } });
    expect(notifications.current()?.title).toBe("GRAB Dune");
    const [ev] = recentEvents(db, "radarr", null);
    expect(ev).toMatchObject({ processed: true, matched_rule: "Grabbed", error: null, payload: { eventType: "Grab" } });
    expect(ev.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{9}Z$/);
  });

  it("falls back to the default display, honours display_on_no_match and disabled", async () => {
    const s = setup();
    const r = await ingestWebhook(s.db, "radarr", { eventType: "Download", movie: { title: "Dune" } }, s.ctx);
    expect(r.body).toMatchObject({ processed: true, message: "Processed with default display settings" });
    expect(s.notifications.current()?.title).toBe("Dune");

    const quiet = setup({ display_on_no_match: false });
    expect((await ingestWebhook(quiet.db, "radarr", { eventType: "Other" }, quiet.ctx)).body).toMatchObject({ processed: false, message: "No rules matched" });

    const off = setup({ enabled: false });
    expect((await ingestWebhook(off.db, "radarr", {}, off.ctx)).body).toMatchObject({ processed: false, message: "Webhook 'radarr' is disabled" });
  });

  it("runs default actions and records failures without stopping", async () => {
    const s = setup({ rules: [], default_actions: [{ action_type: "ForwardWebhook", parameters: {} }, { action_type: "PlaySound", parameters: { sound_type: "beep" } }] });
    const r = await ingestWebhook(s.db, "radarr", {}, s.ctx);
    expect(r.body.actions_taken).toEqual(["Action failed: Forward webhook requires url parameter", "Played sound beep for 500ms"]);
    expect(r.body.error).toBe("ForwardWebhook action failed: Forward webhook requires url parameter");
    expect(s.buzz).toHaveBeenCalledWith(500);
  });

  it("does not log when log_events is off", async () => {
    const s = setup({ log_events: false });
    await ingestWebhook(s.db, "radarr", { eventType: "Grab" }, s.ctx);
    expect(recentEvents(s.db, null, null)).toHaveLength(0);
  });
});

describe("storage", () => {
  it("round-trips webhooks with the column split and generates missing secrets", () => {
    const { db } = setup({ secret: "" });
    const row = db.prepare("SELECT secret, config FROM webhooks").get() as { secret: string; config: string };
    expect(row.secret).toBe("");
    expect(JSON.parse(row.config)).not.toHaveProperty("secret");
    expect(ensureSecrets(db)).toBe(1);
    expect(loadWebhooks(db)[0].secret).toMatch(/^[0-9a-f]{64}$/);
    expect(loadWebhooks(db)[0].rules[0].conditions[0].operator).toBe("Equals");
  });

  it("trims events per webhook and overall", () => {
    const { db } = setup();
    const ev = (i: number, name = "radarr") => ({ id: `e${i}`, webhook_name: name, timestamp: "2026-10-07T00:00:00.000000000Z", payload: i, processed: true, actions_taken: [], error: null, matched_rule: null });
    for (let i = 0; i < 5; i++) logEvent(db, ev(i), 2);
    expect(recentEvents(db, "radarr", null).map((e) => e.id)).toEqual(["e4", "e3"]);
    for (let i = 0; i < MAX_TOTAL_EVENTS + 5; i++) logEvent(db, ev(100 + i, `w${i}`), 10);
    expect(recentEvents(db, null, null)).toHaveLength(MAX_TOTAL_EVENTS);
  });
});

describe("notification rendering", () => {
  it("maps icons and shortens titles", () => {
    expect(iconCode("📺 tv")).toBe("TV");
    expect(iconCode("ab")).toBe("AB");
    expect(firstWord("dune: part two", 4)).toBe("DUNE");
    expect(firstWord("  ", 4)).toBe("");
  });

  it("draws text centred, and flashes by swapping colours", () => {
    const n = { title: "Dune", subtitle: "", icon: "", iconImage: null, expiry: Infinity, displayMode: "text", backgroundColor: "000080", textColor: "FFFFFF", flash: false, flashSpeedMs: 500, image: null };
    const c = renderNotification(n);
    expect(c.get(0, 0)).toEqual([0, 0, 128]);
    expect(c.get(1, 2)).toEqual([255, 255, 255]); // "DUNE": width 15, x=(16-15)/2=0 -> D at 0..2
    const flashed = renderNotification({ ...n, flash: true }, 0);
    expect(flashed.get(0, 0)).toEqual([255, 255, 255]);
  });

  it("blinks image notifications when flashing", () => {
    const data = new Uint8Array(16 * 16 * 4).fill(200);
    const n = { title: "", subtitle: "", icon: "", iconImage: null, expiry: Infinity, displayMode: "image", backgroundColor: "", textColor: "", flash: true, flashSpeedMs: 100, image: { width: 16, height: 16, data } };
    expect(renderNotification(n, 0).get(0, 0)).toEqual([200, 200, 200]);
    expect(renderNotification(n, 100).get(0, 0)).toEqual([0, 0, 0]);
  });

  it("expires", () => {
    let now = 0;
    const m = new NotificationManager(() => now);
    m.trigger({ title: "x", subtitle: "", icon: "", iconImage: null, durationSecs: 2, displayMode: "text", backgroundColor: "", textColor: "", flash: false, flashSpeedMs: 500 });
    expect(m.current()).not.toBeNull();
    now = 2000;
    expect(m.current()).toBeNull();
  });
});
