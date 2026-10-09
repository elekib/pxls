// Incoming webhooks: authenticate, run rules and actions, log the event.
// Port of routes/webhooks.rs and the webhook parts of auth.rs.

import { randomUUID } from "node:crypto";
import { constantTimeEq } from "@/lib/auth/util";
import type { Db } from "@/lib/db/sqlite";
import { executeAction, type ActionContext } from "./actions";
import { defaultDisplayAction, displayDefaults, evaluateRule, type DisplayDefaults } from "./match";
import type { Action, Json, WebhookEvent } from "./model";
import { findWebhook, loadWebhooks, logEvent, nowTimestamp } from "./store";

/** Upper bound for an action's delay_ms, so one rule cannot hold a request open long. */
const MAX_ACTION_DELAY_MS = 15_000;

/**
 * The secret a sender supplied, in order: X-Webhook-Secret, the password of
 * HTTP Basic auth (Radarr and Sonarr support this), or ?secret=.
 */
export function extractWebhookSecret(headers: Headers, search: string): string | null {
  const h = headers.get("x-webhook-secret");
  if (h !== null) return h.trim();
  const auth = headers.get("authorization");
  if (auth) {
    const i = auth.indexOf(" ");
    if (i > 0 && auth.slice(0, i).toLowerCase() === "basic") {
      try {
        const decoded = Buffer.from(auth.slice(i + 1).trim(), "base64").toString("utf8");
        const colon = decoded.indexOf(":");
        if (colon >= 0) return decoded.slice(colon + 1);
      } catch {
        // fall through
      }
    }
  }
  for (const pair of search.replace(/^\?/, "").split("&")) {
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq) === "secret") {
      try {
        return decodeURIComponent(pair.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** A webhook with no secret rejects everything (fail closed). */
export const webhookSecretOk = (expected: string, provided: string | null) => !!expected && provided !== null && constantTimeEq(provided, expected);

export interface Outcome {
  status: number;
  processed: boolean;
  matchedRule: string | null;
  actionsTaken: string[];
  message: string;
  error: string | null;
  logEvent: boolean;
  maxEvents: number;
}

async function runActions(actions: Action[], payload: Json, d: DisplayDefaults, ctx: ActionContext) {
  const taken: string[] = [];
  const failures: string[] = [];
  for (const a of actions) {
    const delay = a.parameters.delay_ms;
    if (typeof delay === "number" && Number.isInteger(delay) && delay > 0) {
      await new Promise((r) => setTimeout(r, Math.min(delay, MAX_ACTION_DELAY_MS)));
    }
    try {
      taken.push(await executeAction(a, payload, d, ctx));
    } catch (e) {
      const msg = (e as Error).message;
      taken.push(`Action failed: ${msg}`);
      failures.push(`${a.action_type} action failed: ${msg}`);
    }
  }
  return { taken, error: failures.length ? failures.join("; ") : null };
}

export async function processWebhook(db: Db, name: string, payload: Json, ctx: ActionContext): Promise<Outcome> {
  const w = findWebhook(loadWebhooks(db), name);
  const base: Outcome = { status: 200, processed: false, matchedRule: null, actionsTaken: [], message: "", error: null, logEvent: true, maxEvents: 100 };
  if (!w) {
    const message = `Webhook '${name}' not found in configuration`;
    return { ...base, status: 404, message, error: message };
  }
  const out: Outcome = { ...base, logEvent: w.log_events, maxEvents: Math.max(1, w.max_events) };
  if (!w.enabled) return { ...out, message: `Webhook '${w.name}' is disabled` };

  const d = displayDefaults(w);
  // Rules in order; the first match wins.
  const rule = w.rules.find((r) => evaluateRule(r, payload).matched);
  if (rule) {
    const r = await runActions(rule.actions, payload, d, ctx);
    return { ...out, processed: true, matchedRule: rule.name, actionsTaken: r.taken, error: r.error, message: `Matched rule '${rule.name}'` };
  }
  if (w.default_actions.length) {
    const r = await runActions(w.default_actions, payload, d, ctx);
    return { ...out, processed: true, actionsTaken: r.taken, error: r.error, message: "No rules matched; ran default actions" };
  }
  // Implicit default display: always without rules; with rules only if display_on_no_match.
  if (w.rules.length === 0 || w.display_on_no_match) {
    const action = defaultDisplayAction(d);
    if (!action) return { ...out, message: "No rules matched and image display mode requires image_url_field" };
    const r = await runActions([action], payload, d, ctx);
    return { ...out, processed: true, actionsTaken: r.taken, error: r.error, message: "Processed with default display settings" };
  }
  return { ...out, message: "No rules matched" };
}

/** Process a payload, log the event, and build the response body. Used by live deliveries and replays. */
export async function ingestWebhook(db: Db, name: string, payload: Json, ctx: ActionContext): Promise<{ status: number; body: Record<string, unknown> }> {
  const id = randomUUID();
  const o = await processWebhook(db, name, payload, ctx);
  if (o.logEvent) {
    const event: WebhookEvent = {
      id, webhook_name: name, timestamp: nowTimestamp(), payload, processed: o.processed,
      actions_taken: o.actionsTaken, error: o.error, matched_rule: o.matchedRule,
    };
    try {
      logEvent(db, event, o.maxEvents);
    } catch (e) {
      console.warn(`[webhook] failed to persist event: ${(e as Error).message}`);
    }
  }
  const body: Record<string, unknown> = {
    success: o.status >= 200 && o.status < 300,
    processed: o.processed,
    message: o.message,
    event_id: id,
    actions_taken: o.actionsTaken,
    webhook_name: name,
  };
  if (o.matchedRule) body.matched_rule = o.matchedRule;
  if (o.error) body.error = o.error;
  return { status: o.status, body };
}
