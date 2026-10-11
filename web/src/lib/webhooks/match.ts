// Field extraction, rule evaluation and placeholders, with loose
// comparisons.

import type { Action, Condition, Json, Rule, Webhook } from "./model";

const isObj = (v: Json | undefined): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);

/** A value as text: numbers as JSON, strings raw, null empty. */
export function valueToString(v: Json): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "";
  return JSON.stringify(v);
}

function getChild(v: Json, key: string): Json | undefined {
  // A numeric segment indexes arrays first, then numeric object keys.
  if (/^\d+$/.test(key) && Array.isArray(v)) return v[Number(key)];
  return isObj(v) && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined;
}

/**
 * Value at a dot path. Supports "movie.title", "images[0].url",
 * "items.0.name", "a[0][1]" and "images[coverType=poster].remoteUrl" (the
 * first array element whose field matches).
 */
export function extractField(data: Json, path: string): Json | undefined {
  let cur: Json | undefined = data;
  for (const segment of path.split(".")) {
    if (segment === "" || cur === undefined) return undefined;
    const b = segment.indexOf("[");
    const name = b < 0 ? segment : segment.slice(0, b);
    let rest = b < 0 ? "" : segment.slice(b);
    if (name !== "") {
      cur = getChild(cur, name);
      if (cur === undefined) return undefined;
    }
    while (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end < 0) return undefined;
      const inner = rest.slice(1, end);
      const eq = inner.indexOf("=");
      if (eq >= 0) {
        const key = inner.slice(0, eq).trim();
        const wanted = inner.slice(eq + 1).trim();
        if (!Array.isArray(cur)) return undefined;
        cur = cur.find((item) => isObj(item) && key in item && valueToString(item[key]) === wanted);
      } else {
        if (!/^\d+$/.test(inner) || !Array.isArray(cur)) return undefined;
        cur = cur[Number(inner)];
      }
      if (cur === undefined) return undefined;
      rest = rest.slice(end + 1);
    }
    if (rest !== "") return undefined;
  }
  return cur;
}

export const extractFieldAsString = (data: Json, path: string) => {
  const v = extractField(data, path);
  return v === undefined ? undefined : valueToString(v);
};

const FLOAT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|infinity|nan)$/i;

function toF64(v: Json): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const s = v.trim();
    if (!FLOAT.test(s)) return undefined;
    const l = s.toLowerCase().replace(/^\+/, "");
    if (l === "inf" || l === "infinity") return Infinity;
    if (l === "-inf" || l === "-infinity") return -Infinity;
    if (l.endsWith("nan")) return NaN;
    return Number(s);
  }
  return undefined;
}

function toBool(v: Json): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return undefined;
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Loose equality: numbers numerically ("5" == 5), booleans vs "true"/"false", else strings. */
export function valuesEqual(a: Json, b: Json, ci: boolean): boolean {
  if (deepEqual(a, b)) return true;
  const x = toF64(a);
  const y = toF64(b);
  if (x !== undefined && y !== undefined) return x === y;
  const p = toBool(a);
  const q = toBool(b);
  if (p !== undefined && q !== undefined) return p === q;
  const sa = valueToString(a);
  const sb = valueToString(b);
  return ci ? sa.toLowerCase() === sb.toLowerCase() : sa === sb;
}

const strContains = (h: string, n: string, ci: boolean) => (ci ? h.toLowerCase().includes(n.toLowerCase()) : h.includes(n));

function valueContains(field: Json, expected: Json, ci: boolean): boolean {
  if (typeof field === "string") return strContains(field, valueToString(expected), ci);
  if (Array.isArray(field)) return field.some((el) => valuesEqual(el, expected, ci) || (typeof el === "string" && valueContains(el, expected, ci)));
  return false;
}

function compare(field: Json, expected: Json, op: Condition["operator"], ci: boolean): boolean {
  switch (op) {
    case "Equals":
      return valuesEqual(field, expected, ci);
    case "NotEquals":
      return !valuesEqual(field, expected, ci);
    case "Contains":
      return valueContains(field, expected, ci);
    case "NotContains":
      return !valueContains(field, expected, ci);
    case "GreaterThan":
    case "LessThan": {
      const a = toF64(field);
      const b = toF64(expected);
      if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === "GreaterThan" ? a > b : a < b;
    }
    default:
      return false;
  }
}

export interface ConditionEvaluation {
  field_path: string;
  operator: string;
  expected: Json;
  actual: Json | null;
  passed: boolean;
}

export interface RuleEvaluation {
  rule_id: string;
  rule_name: string;
  enabled: boolean;
  skipped: boolean;
  matched: boolean;
  conditions: ConditionEvaluation[];
}

export function evaluateCondition(c: Condition, payload: Json): ConditionEvaluation {
  const actual = extractField(payload, c.field_path);
  let passed: boolean;
  if (c.operator === "Exists") passed = actual !== undefined;
  else if (c.operator === "NotExists") passed = actual === undefined;
  else passed = actual !== undefined && compare(actual, c.value, c.operator, c.case_insensitive);
  return { field_path: c.field_path, operator: c.operator, expected: c.value, actual: actual === undefined ? null : actual, passed };
}

/** A rule with no conditions never matches (default actions are the catch-all). */
export function evaluateRule(rule: Rule, payload: Json): RuleEvaluation {
  if (!rule.enabled) {
    return { rule_id: rule.id, rule_name: rule.name, enabled: false, skipped: true, matched: false, conditions: [] };
  }
  const conditions = rule.conditions.map((c) => evaluateCondition(c, payload));
  const matched =
    conditions.length > 0 && (rule.condition_logic === "All" ? conditions.every((c) => c.passed) : conditions.some((c) => c.passed));
  return { rule_id: rule.id, rule_name: rule.name, enabled: rule.enabled, skipped: false, matched, conditions };
}

/** Replace "{field.path}" placeholders; unresolvable paths become "". */
export function substitutePlaceholders(template: string, payload: Json): string {
  let out = "";
  let rest = template;
  for (let start = rest.indexOf("{"); start >= 0; start = rest.indexOf("{")) {
    out += rest.slice(0, start);
    const end = rest.indexOf("}", start);
    if (end < 0) {
      out += rest.slice(start);
      rest = "";
      break;
    }
    const path = rest.slice(start + 1, end);
    out += path === "" || path.includes("{") || path.includes(" ") ? rest.slice(start, end + 1) : (extractFieldAsString(payload, path) ?? "");
    rest = rest.slice(end + 1);
  }
  return out + rest;
}

const hasParam = (a: Action, k: string) => typeof a.parameters[k] === "string" && (a.parameters[k] as string).trim() !== "";

/** Required parameters per action type; a readable message on failure. */
export function validateAction(a: Action): string | null {
  if (a.action_type === "DisplayImage") {
    const src = typeof a.parameters.image_source === "string" ? a.parameters.image_source : "url";
    if (src === "base64" && !hasParam(a, "base64_data")) return "DisplayImage with base64 source requires 'base64_data'";
    if (src === "text_overlay" && !hasParam(a, "base_image_url")) return "DisplayImage with text_overlay source requires 'base_image_url'";
    if (!["url", "base64", "template", "text_overlay"].includes(src)) return `Unsupported image_source: '${src}'`;
  }
  if (a.action_type === "ForwardWebhook" && !hasParam(a, "url")) return "ForwardWebhook requires a 'url' parameter";
  return null;
}

export function validateRule(r: Rule): string | null {
  if (!r.name.trim()) return "Rule name is required";
  if (r.conditions.length === 0) return "Rule must have at least one condition (use the webhook's default actions for a catch-all)";
  if (r.actions.length === 0) return "Rule must have at least one action";
  for (let i = 0; i < r.conditions.length; i++) {
    if (!r.conditions[i].field_path.trim()) return `Condition ${i + 1}: field_path is required`;
  }
  for (let i = 0; i < r.actions.length; i++) {
    const e = validateAction(r.actions[i]);
    if (e) return `Action ${i + 1}: ${e}`;
  }
  return null;
}

/** Display settings inherited by actions that don't set their own. */
export interface DisplayDefaults {
  title_field: string;
  subtitle_field: string;
  image_url_field: string;
  duration_secs: number;
  display_mode: string;
  background_color: string;
  text_color: string;
  icon: string;
  icon_image_url: string;
  flash: boolean;
  flash_speed_ms: number;
}

export const displayDefaults = (w: Webhook): DisplayDefaults => ({
  title_field: w.title_field,
  subtitle_field: w.subtitle_field,
  image_url_field: w.image_url_field,
  duration_secs: w.duration_secs,
  display_mode: w.display_mode,
  background_color: w.background_color,
  text_color: w.text_color,
  icon: w.icon,
  icon_image_url: w.icon_image_url,
  flash: w.flash,
  flash_speed_ms: w.flash_speed_ms,
});

/** The implicit display action when no rule matched; null for image mode without a field. */
export function defaultDisplayAction(d: DisplayDefaults): Action | null {
  if (d.display_mode === "image") {
    if (!d.image_url_field.trim()) return null;
    return { action_type: "DisplayImage", parameters: { image_source: "url", url: `{${d.image_url_field}}`, width: 64, height: 64 } };
  }
  return {
    action_type: "DisplayNotification",
    parameters: {
      title: d.title_field.trim() ? `{${d.title_field}}` : "Notification",
      subtitle: d.subtitle_field.trim() ? `{${d.subtitle_field}}` : "",
    },
  };
}
