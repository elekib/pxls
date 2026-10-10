import { describe, expect, it } from "vitest";
import { defaultDisplayAction, evaluateRule, extractField, substitutePlaceholders, validateRule, valuesEqual } from "@/lib/webhooks/match";
import { parseRule, type Json } from "@/lib/webhooks/model";

const payload: Json = {
  eventType: "Download",
  movie: { title: "Dune", year: 2021, tags: ["scifi", "Epic"] },
  images: [{ coverType: "fanart", remoteUrl: "f.jpg" }, { coverType: "poster", remoteUrl: "p.jpg" }],
  items: [{ name: "a" }, { name: "b" }],
  grid: [[1, 2], [3, 4]],
  count: "5",
  flag: "true",
  nothing: null,
};

describe("extractField", () => {
  it("follows dots, indexes and selectors", () => {
    expect(extractField(payload, "movie.title")).toBe("Dune");
    expect(extractField(payload, "images[1].remoteUrl")).toBe("p.jpg");
    expect(extractField(payload, "items.0.name")).toBe("a");
    expect(extractField(payload, "grid[1][0]")).toBe(3);
    expect(extractField(payload, "images[coverType=poster].remoteUrl")).toBe("p.jpg");
    expect(extractField(payload, "images[ coverType = poster ].remoteUrl")).toBe("p.jpg");
  });

  it("returns nothing for bad or missing paths", () => {
    for (const p of ["movie.missing", "images[9].remoteUrl", "images[coverType=banner]", "movie..title", "", "grid[1]x", "images[x]"]) {
      expect(extractField(payload, p)).toBeUndefined();
    }
    expect(extractField(payload, "nothing")).toBeNull();
  });
});

describe("conditions", () => {
  const rule = (conds: object[], logic = "all") => parseRule({ name: "r", conditions: conds, actions: [{ action_type: "log_event" }], condition_logic: logic });

  it("compares loosely like Rust", () => {
    expect(valuesEqual("5", 5, false)).toBe(true);
    expect(valuesEqual(true, "true", false)).toBe(true);
    expect(valuesEqual("Dune", "dune", true)).toBe(true);
    expect(valuesEqual("Dune", "dune", false)).toBe(false);
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }, false)).toBe(true);
  });

  it("evaluates each operator", () => {
    const m = (c: object) => evaluateRule(rule([c]), payload).matched;
    expect(m({ field_path: "eventType", operator: "eq", value: "Download" })).toBe(true);
    expect(m({ field_path: "eventType", operator: "ne", value: "Grab" })).toBe(true);
    expect(m({ field_path: "movie.title", operator: "contains", value: "un" })).toBe(true);
    expect(m({ field_path: "movie.tags", operator: "contains", value: "epic", case_insensitive: true })).toBe(true);
    expect(m({ field_path: "movie.tags", operator: "not_contains", value: "horror" })).toBe(true);
    expect(m({ field_path: "count", operator: "gt", value: 4 })).toBe(true);
    expect(m({ field_path: "movie.year", operator: "lt", value: "2000" })).toBe(false);
    expect(m({ field_path: "movie.title", operator: "exists" })).toBe(true);
    expect(m({ field_path: "movie.rating", operator: "not_exists" })).toBe(true);
    // A missing field fails every comparison, even NotEquals.
    expect(m({ field_path: "missing", operator: "ne", value: "x" })).toBe(false);
  });

  it("combines with All / Any, never matches without conditions, skips disabled rules", () => {
    const yes = { field_path: "eventType", operator: "Equals", value: "Download" };
    const no = { field_path: "eventType", operator: "Equals", value: "Grab" };
    expect(evaluateRule(rule([yes, no], "and"), payload).matched).toBe(false);
    expect(evaluateRule(rule([yes, no], "or"), payload).matched).toBe(true);
    expect(evaluateRule(rule([]), payload).matched).toBe(false);
    const off = parseRule({ name: "off", enabled: false, conditions: [yes], actions: [] });
    expect(evaluateRule(off, payload)).toMatchObject({ skipped: true, matched: false });
  });

  it("stores canonical enum names and rejects unknown ones", () => {
    const r = rule([{ field_path: "x", operator: "gt", value: 1 }], "or");
    expect([r.conditions[0].operator, r.condition_logic, r.actions[0].action_type]).toEqual(["GreaterThan", "Any", "LogEvent"]);
    expect(() => parseRule({ name: "r", conditions: [{ field_path: "x", operator: "approx" }] })).toThrow(/unknown variant/);
    expect(() => parseRule({ conditions: [] })).toThrow(/missing field `name`/);
  });
});

describe("placeholders and validation", () => {
  it("substitutes paths and leaves odd braces alone", () => {
    expect(substitutePlaceholders("{movie.title} ({movie.year})", payload)).toBe("Dune (2021)");
    expect(substitutePlaceholders("{missing}!", payload)).toBe("!");
    expect(substitutePlaceholders("{} {a b} {open", payload)).toBe("{} {a b} {open");
    expect(substitutePlaceholders("{movie.tags}", payload)).toBe('["scifi","Epic"]');
  });

  it("validates rules and actions", () => {
    const base = { name: "r", conditions: [{ field_path: "x", operator: "exists" }], actions: [{ action_type: "LogEvent" }] };
    expect(validateRule(parseRule(base))).toBeNull();
    expect(validateRule(parseRule({ ...base, name: " " }))).toBe("Rule name is required");
    expect(validateRule(parseRule({ ...base, conditions: [] }))).toMatch(/at least one condition/);
    expect(validateRule(parseRule({ ...base, actions: [] }))).toMatch(/at least one action/);
    expect(validateRule(parseRule({ ...base, conditions: [{ field_path: "", operator: "exists" }] }))).toBe("Condition 1: field_path is required");
    expect(validateRule(parseRule({ ...base, actions: [{ action_type: "ForwardWebhook" }] }))).toBe("Action 1: ForwardWebhook requires a 'url' parameter");
    expect(validateRule(parseRule({ ...base, actions: [{ action_type: "DisplayImage", parameters: { image_source: "ftp" } }] }))).toBe("Action 1: Unsupported image_source: 'ftp'");
  });

  it("builds the implicit default display", () => {
    const d = { title_field: "movie.title", subtitle_field: "", image_url_field: "", duration_secs: 10, display_mode: "text", background_color: "", text_color: "", icon: "", icon_image_url: "", flash: false, flash_speed_ms: 500 };
    expect(defaultDisplayAction(d)).toEqual({ action_type: "DisplayNotification", parameters: { title: "{movie.title}", subtitle: "" } });
    expect(defaultDisplayAction({ ...d, display_mode: "image" })).toBeNull();
    expect(defaultDisplayAction({ ...d, display_mode: "image", image_url_field: "img" })?.parameters.url).toBe("{img}");
  });
});
