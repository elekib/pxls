// Webhook, rule and event types, with aliases accepted on input
// ("eq", "display_notification", "and"...); stored values are canonical.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const OPERATORS = ["Equals", "NotEquals", "Contains", "NotContains", "GreaterThan", "LessThan", "Exists", "NotExists"] as const;
export type Operator = (typeof OPERATORS)[number];

export const ACTION_TYPES = ["DisplayNotification", "DisplayImage", "FlashScreen", "PlaySound", "LogEvent", "ForwardWebhook"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type ConditionLogic = "All" | "Any";

export interface Condition {
  field_path: string;
  operator: Operator;
  value: Json;
  case_insensitive: boolean;
}

export interface Action {
  action_type: ActionType;
  parameters: Record<string, Json>;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: Condition[];
  actions: Action[];
  condition_logic: ConditionLogic;
}

export interface Webhook {
  name: string;
  enabled: boolean;
  path: string;
  secret: string;
  log_events: boolean;
  max_events: number;
  rules: Rule[];
  default_actions: Action[];
  display_on_no_match: boolean;
  duration_secs: number;
  display_mode: string;
  background_color: string;
  text_color: string;
  title_field: string;
  subtitle_field: string;
  flash: boolean;
  flash_speed_ms: number;
  icon: string;
  icon_image_url: string;
  image_url_field: string;
}

export interface WebhookEvent {
  id: string;
  webhook_name: string;
  timestamp: string;
  payload: Json;
  processed: boolean;
  actions_taken: string[];
  error: string | null;
  matched_rule: string | null;
}

/** Thrown when input doesn't match the schema */
export class ParseError extends Error {}

const ALIASES: Record<string, string> = {};
const alias = (canonical: string, ...names: string[]) => {
  ALIASES[canonical] = canonical;
  for (const n of names) ALIASES[n] = canonical;
};
alias("Equals", "equals", "eq");
alias("NotEquals", "not_equals", "ne", "notequals");
alias("Contains", "contains");
alias("NotContains", "not_contains", "notcontains");
alias("GreaterThan", "greater_than", "gt", "greaterthan");
alias("LessThan", "less_than", "lt", "lessthan");
alias("Exists", "exists");
alias("NotExists", "not_exists", "notexists");
alias("DisplayNotification", "display_notification", "displaynotification");
alias("DisplayImage", "display_image", "displayimage");
alias("FlashScreen", "flash_screen", "flashscreen");
alias("PlaySound", "play_sound", "playsound");
alias("LogEvent", "log_event", "logevent");
alias("ForwardWebhook", "forward_webhook", "forwardwebhook");
alias("All", "all", "and");
alias("Any", "any", "or");

function variant<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  const c = typeof v === "string" ? ALIASES[v] : undefined;
  if (!c || !allowed.includes(c as T)) throw new ParseError(`unknown variant \`${String(v)}\` for ${what}`);
  return c as T;
}

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ParseError(`invalid type: expected ${what}`);
  return v as Record<string, unknown>;
};
const reqStr = (o: Record<string, unknown>, k: string) => {
  if (typeof o[k] !== "string") throw new ParseError(o[k] === undefined ? `missing field \`${k}\`` : `invalid type for \`${k}\`, expected a string`);
  return o[k] as string;
};
const optBool = (o: Record<string, unknown>, k: string, d: boolean) => {
  if (o[k] === undefined) return d;
  if (typeof o[k] !== "boolean") throw new ParseError(`invalid type for \`${k}\`, expected a boolean`);
  return o[k] as boolean;
};
const optArr = (o: Record<string, unknown>, k: string) => {
  if (o[k] === undefined) return [];
  if (!Array.isArray(o[k])) throw new ParseError(`invalid type for \`${k}\`, expected a sequence`);
  return o[k] as unknown[];
};

export function parseCondition(v: unknown): Condition {
  const o = obj(v, "a condition");
  if (o.operator === undefined) throw new ParseError("missing field `operator`");
  return {
    field_path: reqStr(o, "field_path"),
    operator: variant(o.operator, OPERATORS, "operator"),
    value: (o.value ?? null) as Json,
    case_insensitive: optBool(o, "case_insensitive", false),
  };
}

export function parseAction(v: unknown): Action {
  const o = obj(v, "an action");
  if (o.action_type === undefined) throw new ParseError("missing field `action_type`");
  const params = o.parameters === undefined ? {} : obj(o.parameters, "a map of parameters");
  return { action_type: variant(o.action_type, ACTION_TYPES, "action_type"), parameters: params as Record<string, Json> };
}

export function parseRule(v: unknown): Rule {
  const o = obj(v, "a rule");
  return {
    id: o.id === undefined ? "" : reqStr(o, "id"),
    name: reqStr(o, "name"),
    enabled: optBool(o, "enabled", true),
    conditions: optArr(o, "conditions").map(parseCondition),
    actions: optArr(o, "actions").map(parseAction),
    condition_logic: o.condition_logic === undefined ? "All" : variant(o.condition_logic, ["All", "Any"] as const, "condition_logic"),
  };
}

/** A stored webhook (columns merged with the JSON settings) as a Webhook. */
export function parseWebhook(o: Record<string, unknown>): Webhook {
  const s = (k: string, d = "") => (typeof o[k] === "string" ? (o[k] as string) : d);
  const n = (k: string, d: number) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? Math.max(0, Math.trunc(o[k] as number)) : d);
  const b = (k: string, d: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : d);
  return {
    name: s("name"),
    enabled: b("enabled", true),
    path: s("path"),
    secret: s("secret"),
    log_events: b("log_events", true),
    max_events: n("max_events", 100),
    rules: Array.isArray(o.rules) ? o.rules.map(parseRule) : [],
    default_actions: Array.isArray(o.default_actions) ? o.default_actions.map(parseAction) : [],
    display_on_no_match: b("display_on_no_match", true),
    duration_secs: n("duration_secs", 10),
    display_mode: s("display_mode", "text"),
    background_color: s("background_color", "000000"),
    text_color: s("text_color", "FFFFFF"),
    title_field: s("title_field"),
    subtitle_field: s("subtitle_field"),
    flash: b("flash", false),
    flash_speed_ms: n("flash_speed_ms", 500),
    icon: s("icon"),
    icon_image_url: s("icon_image_url"),
    image_url_field: s("image_url_field"),
  };
}
