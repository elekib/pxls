// Webhook, rule and event management.

import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/sqlite";
import { evaluateRule, validateAction, validateRule } from "./match";
import { ParseError, parseAction, parseRule, type Action, type Json, type Rule, type Webhook } from "./model";
import { clearEvents, findWebhook, generateSecret, loadWebhooks, MIN_WEBHOOK_SECRET_LEN, recentEvents, replaceWebhooks } from "./store";

export type Result = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>, status = 200): Result => ({ status, body: { success: true, ...body } });
const fail = (status: number, error: string): Result => ({ status, body: { success: false, error } });
const notFound = (name: string) => fail(404, `Webhook '${name}' not found`);

type Body = Record<string, unknown>;
const str = (b: Body, k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
const bool = (b: Body, k: string) => (typeof b[k] === "boolean" ? (b[k] as boolean) : undefined);
const u = (b: Body, k: string) => (typeof b[k] === "number" && Number.isInteger(b[k]) && (b[k] as number) >= 0 ? (b[k] as number) : undefined);

function parseRules(v: unknown): Rule[] | string {
  if (!Array.isArray(v)) return "Invalid rules: expected a sequence";
  try {
    const rules = v.map(parseRule);
    for (const r of rules) {
      if (!r.id) r.id = randomUUID();
      const e = validateRule(r);
      if (e) return e;
    }
    return rules;
  } catch (e) {
    return `Invalid rules: ${(e as Error).message}`;
  }
}

function parseActions(v: unknown): Action[] | string {
  if (!Array.isArray(v)) return "Invalid actions: expected a sequence";
  try {
    const actions = v.map(parseAction);
    for (const a of actions) {
      const e = validateAction(a);
      if (e) return e;
    }
    return actions;
  } catch (e) {
    return `Invalid actions: ${(e as Error).message}`;
  }
}

// ---- webhooks ---------------------------------------------------------------

export const listWebhooks = (): Result => ok({ webhooks: loadWebhooks(getDb()) });

export function getWebhook(name: string): Result {
  const w = findWebhook(loadWebhooks(getDb()), name);
  return w ? ok({ webhook: w }) : notFound(name);
}

export function createWebhook(b: Body): Result {
  const name = str(b, "name");
  if (!name?.trim()) return fail(400, "name is required");
  const rules = b.rules === undefined ? [] : parseRules(b.rules);
  if (typeof rules === "string") return fail(400, rules);
  const defaults = b.default_actions === undefined ? [] : parseActions(b.default_actions);
  if (typeof defaults === "string") return fail(400, defaults);
  const secret = str(b, "secret");
  const w: Webhook = {
    name,
    enabled: bool(b, "enabled") ?? true,
    path: str(b, "path")?.trim() ? str(b, "path")! : name,
    secret: secret && secret.length >= MIN_WEBHOOK_SECRET_LEN ? secret : generateSecret(),
    log_events: bool(b, "log_events") ?? true,
    max_events: u(b, "max_events") ?? 100,
    rules,
    default_actions: defaults,
    display_on_no_match: bool(b, "display_on_no_match") ?? true,
    duration_secs: u(b, "duration_secs") ?? 10,
    display_mode: str(b, "display_mode") ?? "icon_only",
    background_color: str(b, "background_color") ?? "FF0000",
    text_color: str(b, "text_color") ?? "FFFFFF",
    title_field: str(b, "title_field") ?? "title",
    subtitle_field: str(b, "subtitle_field") ?? "subtitle",
    flash: bool(b, "flash") ?? true,
    flash_speed_ms: u(b, "flash_speed_ms") ?? 500,
    icon: str(b, "icon") ?? "📺",
    icon_image_url: str(b, "icon_image_url") ?? "",
    image_url_field: str(b, "image_url_field") ?? "",
  };
  const db = getDb();
  const all = loadWebhooks(db);
  if (all.some((x) => x.name === w.name || x.path === w.path)) return fail(409, `Webhook '${w.name}' already exists`);
  all.push(w);
  replaceWebhooks(db, all);
  return ok({ webhook: w }, 201);
}

export function updateWebhook(name: string, b: Body): Result {
  const db = getDb();
  const all = loadWebhooks(db);
  const w = findWebhook(all, name);
  if (!w) return notFound(name);
  if (str(b, "name")?.trim()) w.name = str(b, "name")!;
  if (str(b, "path")?.trim()) w.path = str(b, "path")!;
  if (bool(b, "regenerate_secret") === true) w.secret = generateSecret();
  else if ((str(b, "secret") ?? "").length >= MIN_WEBHOOK_SECRET_LEN) w.secret = str(b, "secret")!;
  for (const k of ["enabled", "log_events", "display_on_no_match", "flash"] as const) if (bool(b, k) !== undefined) w[k] = bool(b, k)!;
  for (const k of ["max_events", "duration_secs", "flash_speed_ms"] as const) if (u(b, k) !== undefined) w[k] = u(b, k)!;
  for (const k of ["display_mode", "background_color", "text_color", "title_field", "subtitle_field", "icon", "icon_image_url", "image_url_field"] as const) {
    if (str(b, k) !== undefined) w[k] = str(b, k)!;
  }
  if (b.rules !== undefined) {
    const r = parseRules(b.rules);
    if (typeof r === "string") return fail(400, r);
    w.rules = r;
  }
  if (b.default_actions !== undefined) {
    const a = parseActions(b.default_actions);
    if (typeof a === "string") return fail(400, a);
    w.default_actions = a;
  }
  replaceWebhooks(db, all);
  return ok({ webhook: w });
}

export function deleteWebhook(name: string): Result {
  const db = getDb();
  const all = loadWebhooks(db);
  const kept = all.filter((w) => w.name !== name && w.path !== name);
  if (kept.length === all.length) return notFound(name);
  replaceWebhooks(db, kept);
  return ok({ message: `Webhook '${name}' deleted` });
}

// ---- rules ------------------------------------------------------------------

function parseOneRule(v: unknown): Rule | string {
  try {
    const r = parseRule(v);
    if (!r.name.trim()) r.name = `rule_${randomUUID()}`;
    if (!r.id) r.id = randomUUID();
    return validateRule(r) ?? r;
  } catch (e) {
    return `Invalid rule: ${(e as Error).message}`;
  }
}

const ruleKey = (r: Rule, key: string) => r.id === key || r.name === key;

export function listRules(name: string): Result {
  const w = findWebhook(loadWebhooks(getDb()), name);
  return w ? ok({ webhook: w.name, rules: w.rules }) : notFound(name);
}

export function createRule(name: string, b: unknown): Result {
  const rule = parseOneRule(b);
  if (typeof rule === "string") return fail(400, rule);
  const db = getDb();
  const all = loadWebhooks(db);
  const w = findWebhook(all, name);
  if (!w) return notFound(name);
  if (w.rules.some((r) => r.name === rule.name)) return fail(409, `A rule named '${rule.name}' already exists`);
  w.rules.push(rule);
  replaceWebhooks(db, all);
  return ok({ rule });
}

export function updateRule(name: string, ruleId: string, b: unknown): Result {
  const db = getDb();
  const all = loadWebhooks(db);
  const w = findWebhook(all, name);
  if (!w) return notFound(name);
  const i = w.rules.findIndex((r) => ruleKey(r, ruleId));
  if (i < 0) return fail(404, `Rule '${ruleId}' not found in webhook`);
  const rule = parseOneRule(b);
  if (typeof rule === "string") return fail(400, rule);
  rule.id = w.rules[i].id;
  if (w.rules.some((r, j) => j !== i && r.name === rule.name)) return fail(409, `A rule named '${rule.name}' already exists`);
  w.rules[i] = rule;
  replaceWebhooks(db, all);
  return ok({ rule });
}

export function deleteRule(name: string, ruleId: string): Result {
  const db = getDb();
  const all = loadWebhooks(db);
  const w = findWebhook(all, name);
  if (!w) return notFound(name);
  const before = w.rules.length;
  w.rules = w.rules.filter((r) => !ruleKey(r, ruleId));
  if (w.rules.length === before) return fail(404, `Rule '${ruleId}' not found in webhook`);
  replaceWebhooks(db, all);
  return ok({ message: `Rule '${ruleId}' deleted` });
}

/** Dry run: evaluate one (possibly unsaved) rule, or all of the webhook's rules. No actions run. */
export function testRules(name: string, b: Body): Result {
  if (!("payload" in b)) return fail(400, "Request body must include a 'payload' object");
  const payload = b.payload as Json;
  if (b.rule !== undefined) {
    let rule: Rule;
    try {
      rule = parseRule(b.rule);
    } catch (e) {
      return fail(400, `Invalid rule: ${(e as Error).message}`);
    }
    const ev = evaluateRule(rule, payload);
    return ok({ matched: ev.matched, evaluations: [ev], validation_error: validateRule(rule) });
  }
  const w = findWebhook(loadWebhooks(getDb()), name);
  if (!w) return notFound(name);
  const evaluations = w.rules.map((r) => evaluateRule(r, payload));
  const matched = evaluations.find((e) => e.matched)?.rule_name ?? null;
  return ok({
    webhook: w.name,
    matched_rule: matched,
    evaluations,
    would_display_default: matched === null && (w.rules.length === 0 || w.display_on_no_match || w.default_actions.length > 0),
  });
}

/** Reorder rules; `order` must list every rule once (first match wins, so order matters). */
export function reorderRules(name: string, b: Body): Result {
  const order = b.order;
  if (!Array.isArray(order) || !order.every((k) => typeof k === "string")) {
    return fail(400, "Request body must include an 'order' array of rule ids");
  }
  const db = getDb();
  const all = loadWebhooks(db);
  const w = findWebhook(all, name);
  if (!w) return notFound(name);
  const remaining = [...w.rules];
  const reordered: Rule[] = [];
  for (const key of order as string[]) {
    const i = remaining.findIndex((r) => ruleKey(r, key));
    if (i < 0) return fail(400, `Rule '${key}' not found, or listed more than once`);
    reordered.push(...remaining.splice(i, 1));
  }
  if (remaining.length) return fail(400, "'order' must include every rule of the webhook");
  w.rules = reordered;
  replaceWebhooks(db, all);
  return ok({});
}

// ---- events -----------------------------------------------------------------

export function listEvents(webhookName: string | null, limit: number | null): Result {
  const events = recentEvents(getDb(), webhookName, limit);
  return ok({ events, count: events.length });
}

export function clearWebhookEvents(name: string | null): Result {
  clearEvents(getDb(), name);
  return ok({ message: name === null ? "All webhook events cleared" : `Events cleared for webhook: ${name}` });
}

/** Per-webhook delivery summary for the management UI. */
export function eventsSummary(): Result {
  const summary: Record<string, Record<string, unknown>> = {};
  for (const e of recentEvents(getDb(), null, null)) {
    const s = (summary[e.webhook_name] ??= { count: 0, error_count: 0, last_timestamp: null, last_processed: null, last_error: null, last_matched_rule: null });
    s.count = (s.count as number) + 1;
    if (e.error !== null) s.error_count = (s.error_count as number) + 1;
    const last = s.last_timestamp as string | null;
    if (last === null || Date.parse(e.timestamp) > Date.parse(last)) {
      Object.assign(s, { last_timestamp: e.timestamp, last_processed: e.processed, last_error: e.error, last_matched_rule: e.matched_rule });
    }
  }
  return ok({ summary: Object.fromEntries(Object.entries(summary).sort(([a], [b]) => (a < b ? -1 : 1))) });
}

export { ParseError };
