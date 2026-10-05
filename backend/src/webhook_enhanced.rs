use std::cmp::Ordering;
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    pub id: String,
    pub webhook_name: String,
    pub timestamp: DateTime<Utc>,
    pub payload: Value,
    pub processed: bool,
    pub actions_taken: Vec<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub matched_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookCondition {
    pub field_path: String,
    pub operator: ConditionOperator,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub case_insensitive: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConditionOperator {
    #[serde(alias = "equals", alias = "eq")]
    Equals,
    #[serde(alias = "not_equals", alias = "ne", alias = "notequals")]
    NotEquals,
    #[serde(alias = "contains")]
    Contains,
    #[serde(alias = "not_contains", alias = "notcontains")]
    NotContains,
    #[serde(alias = "greater_than", alias = "gt", alias = "greaterthan")]
    GreaterThan,
    #[serde(alias = "less_than", alias = "lt", alias = "lessthan")]
    LessThan,
    #[serde(alias = "exists")]
    Exists,
    #[serde(alias = "not_exists", alias = "notexists")]
    NotExists,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookAction {
    pub action_type: ActionType,
    #[serde(default)]
    pub parameters: HashMap<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ActionType {
    #[serde(alias = "display_notification", alias = "displaynotification")]
    DisplayNotification,
    #[serde(alias = "display_image", alias = "displayimage")]
    DisplayImage,
    #[serde(alias = "flash_screen", alias = "flashscreen")]
    FlashScreen,
    #[serde(alias = "play_sound", alias = "playsound")]
    PlaySound,
    #[serde(alias = "log_event", alias = "logevent")]
    LogEvent,
    #[serde(alias = "forward_webhook", alias = "forwardwebhook")]
    ForwardWebhook,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookRule {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub conditions: Vec<WebhookCondition>,
    #[serde(default)]
    pub actions: Vec<WebhookAction>,
    #[serde(default)]
    pub condition_logic: ConditionLogic,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConditionLogic {
    #[serde(alias = "all", alias = "and")]
    All,
    #[serde(alias = "any", alias = "or")]
    Any,
}

impl Default for ConditionLogic {
    fn default() -> Self {
        ConditionLogic::All
    }
}

fn default_display_on_no_match() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnhancedWebhookConfig {
    pub name: String,
    pub enabled: bool,
    pub path: String,
    pub log_events: bool,
    pub max_events: usize,
    pub rules: Vec<WebhookRule>, // Full rule objects, not just names
    pub default_actions: Vec<WebhookAction>,
    /// When true, the webhook's default display settings are used even if
    /// rules exist but none matched. When false, non-matching events do nothing.
    #[serde(default = "default_display_on_no_match")]
    pub display_on_no_match: bool,
    // Default display settings (used when no rules match)
    pub duration_secs: u32,
    pub display_mode: String,
    pub background_color: String,
    pub text_color: String,
    pub title_field: String,
    pub subtitle_field: String,
    pub flash: bool,
    pub flash_speed_ms: u32,
    pub icon: String,
    pub icon_image_url: String,
    pub image_url_field: String,
}

/// Display configuration inherited by rule actions that don't specify their own.
#[derive(Debug, Clone)]
pub struct DisplayDefaults {
    pub title_field: String,
    pub subtitle_field: String,
    pub image_url_field: String,
    pub duration_secs: u64,
    pub display_mode: String,
    pub background_color: String,
    pub text_color: String,
    pub icon: String,
    pub icon_image_url: String,
    pub flash: bool,
    pub flash_speed_ms: u64,
}

impl Default for DisplayDefaults {
    fn default() -> Self {
        Self {
            title_field: String::new(),
            subtitle_field: String::new(),
            image_url_field: String::new(),
            duration_secs: 10,
            display_mode: "text".to_string(),
            background_color: "000000".to_string(),
            text_color: "FFFFFF".to_string(),
            icon: "🔔".to_string(),
            icon_image_url: String::new(),
            flash: false,
            flash_speed_ms: 500,
        }
    }
}

impl From<&EnhancedWebhookConfig> for DisplayDefaults {
    fn from(w: &EnhancedWebhookConfig) -> Self {
        Self {
            title_field: w.title_field.clone(),
            subtitle_field: w.subtitle_field.clone(),
            image_url_field: w.image_url_field.clone(),
            duration_secs: w.duration_secs as u64,
            display_mode: w.display_mode.clone(),
            background_color: w.background_color.clone(),
            text_color: w.text_color.clone(),
            icon: w.icon.clone(),
            icon_image_url: w.icon_image_url.clone(),
            flash: w.flash,
            flash_speed_ms: w.flash_speed_ms as u64,
        }
    }
}

impl From<&crate::config::WebhookConfig> for DisplayDefaults {
    fn from(w: &crate::config::WebhookConfig) -> Self {
        Self {
            title_field: w.title_field.clone(),
            subtitle_field: w.subtitle_field.clone(),
            image_url_field: w.image_url_field.clone(),
            duration_secs: w.duration_secs,
            display_mode: w.display_mode.clone(),
            background_color: w.background_color.clone(),
            text_color: w.text_color.clone(),
            icon: w.icon.clone(),
            icon_image_url: w.icon_image_url.clone(),
            flash: w.flash,
            flash_speed_ms: w.flash_speed_ms,
        }
    }
}

/// Build the implicit display action used when no rules match (and no explicit
/// default_actions are configured). Returns None when the display mode is
/// "image" but no image_url_field is configured.
pub fn default_display_action(defaults: &DisplayDefaults) -> Option<WebhookAction> {
    let mut params = HashMap::new();

    if defaults.display_mode == "image" {
        if defaults.image_url_field.trim().is_empty() {
            return None;
        }
        params.insert("image_source".to_string(), Value::String("url".to_string()));
        params.insert(
            "url".to_string(),
            Value::String(format!("{{{}}}", defaults.image_url_field)),
        );
        params.insert("width".to_string(), Value::Number(64.into()));
        params.insert("height".to_string(), Value::Number(64.into()));
        Some(WebhookAction {
            action_type: ActionType::DisplayImage,
            parameters: params,
        })
    } else {
        let title = if defaults.title_field.trim().is_empty() {
            "Notification".to_string()
        } else {
            format!("{{{}}}", defaults.title_field)
        };
        let subtitle = if defaults.subtitle_field.trim().is_empty() {
            String::new()
        } else {
            format!("{{{}}}", defaults.subtitle_field)
        };
        params.insert("title".to_string(), Value::String(title));
        params.insert("subtitle".to_string(), Value::String(subtitle));
        Some(WebhookAction {
            action_type: ActionType::DisplayNotification,
            parameters: params,
        })
    }
}

/// Extract a field from JSON using dot notation.
/// Supports "movie.title", "images[0].url", "items.0.name", "a[0][1]" and
/// "images[coverType=poster].remoteUrl" (first array element where the field matches).
pub fn extract_field(data: &Value, field_path: &str) -> Option<Value> {
    let mut current = data;

    for segment in field_path.split('.') {
        if segment.is_empty() {
            return None;
        }

        // Split "images[0][1]" into field name and bracketed indices
        let (name, mut indices) = match segment.find('[') {
            Some(pos) => (&segment[..pos], &segment[pos..]),
            None => (segment, ""),
        };

        if !name.is_empty() {
            current = get_child(current, name)?;
        }

        while indices.starts_with('[') {
            let end = indices.find(']')?;
            let inner = &indices[1..end];
            current = match inner.split_once('=') {
                // "[coverType=poster]" selects the first array element whose
                // field matches, so paths don't depend on array ordering
                Some((key, wanted)) => current.as_array()?.iter().find(|item| {
                    item.get(key.trim())
                        .map(|v| value_to_string(v) == wanted.trim())
                        .unwrap_or(false)
                })?,
                None => current.get(inner.parse::<usize>().ok()?)?,
            };
            indices = &indices[end + 1..];
        }
        if !indices.is_empty() {
            return None;
        }
    }

    Some(current.clone())
}

fn get_child<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    // A numeric segment indexes into arrays first, then numeric object keys
    if let Ok(index) = key.parse::<usize>() {
        if let Some(arr) = value.as_array() {
            return arr.get(index);
        }
    }
    value.get(key)
}

pub fn extract_field_as_string(data: &Value, field_path: &str) -> Option<String> {
    extract_field(data, field_path).map(|v| match v {
        Value::String(s) => s,
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    })
}

fn coerce_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn coerce_bool(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Loose equality: numbers compare numerically ("5" == 5), booleans compare
/// against "true"/"false" strings, otherwise string comparison.
fn values_equal(a: &Value, b: &Value, case_insensitive: bool) -> bool {
    if a == b {
        return true;
    }
    if let (Some(x), Some(y)) = (coerce_f64(a), coerce_f64(b)) {
        return x == y;
    }
    if let (Some(x), Some(y)) = (coerce_bool(a), coerce_bool(b)) {
        return x == y;
    }
    let (sa, sb) = (value_to_string(a), value_to_string(b));
    if case_insensitive {
        sa.eq_ignore_ascii_case(&sb)
    } else {
        sa == sb
    }
}

fn str_contains(haystack: &str, needle: &str, case_insensitive: bool) -> bool {
    if case_insensitive {
        haystack.to_lowercase().contains(&needle.to_lowercase())
    } else {
        haystack.contains(needle)
    }
}

fn value_contains(field: &Value, expected: &Value, case_insensitive: bool) -> bool {
    match field {
        Value::String(s) => str_contains(s, &value_to_string(expected), case_insensitive),
        Value::Array(arr) => arr.iter().any(|el| {
            values_equal(el, expected, case_insensitive)
                || (el.is_string() && value_contains(el, expected, case_insensitive))
        }),
        _ => false,
    }
}

fn compare_values(field: &Value, expected: &Value, op: ConditionOperator, ci: bool) -> bool {
    match op {
        ConditionOperator::Equals => values_equal(field, expected, ci),
        ConditionOperator::NotEquals => !values_equal(field, expected, ci),
        ConditionOperator::Contains => value_contains(field, expected, ci),
        ConditionOperator::NotContains => !value_contains(field, expected, ci),
        ConditionOperator::GreaterThan => matches!(
            coerce_f64(field).and_then(|a| coerce_f64(expected).and_then(|b| a.partial_cmp(&b))),
            Some(Ordering::Greater)
        ),
        ConditionOperator::LessThan => matches!(
            coerce_f64(field).and_then(|a| coerce_f64(expected).and_then(|b| a.partial_cmp(&b))),
            Some(Ordering::Less)
        ),
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ConditionEvaluation {
    pub field_path: String,
    pub operator: String,
    pub expected: Value,
    pub actual: Option<Value>,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuleEvaluation {
    pub rule_id: String,
    pub rule_name: String,
    pub enabled: bool,
    pub skipped: bool,
    pub matched: bool,
    pub conditions: Vec<ConditionEvaluation>,
}

pub fn evaluate_condition_verbose(condition: &WebhookCondition, payload: &Value) -> ConditionEvaluation {
    let actual = extract_field(payload, &condition.field_path);

    let passed = match condition.operator {
        ConditionOperator::Exists => actual.is_some(),
        ConditionOperator::NotExists => actual.is_none(),
        op => match &actual {
            Some(field_val) => compare_values(field_val, &condition.value, op, condition.case_insensitive),
            None => false,
        },
    };

    ConditionEvaluation {
        field_path: condition.field_path.clone(),
        operator: format!("{:?}", condition.operator),
        expected: condition.value.clone(),
        actual,
        passed,
    }
}

pub fn evaluate_condition(condition: &WebhookCondition, payload: &Value) -> bool {
    evaluate_condition_verbose(condition, payload).passed
}

/// Evaluate a rule against a payload, returning per-condition detail.
/// A rule with no conditions never matches (use default actions for catch-all).
pub fn evaluate_rule_verbose(rule: &WebhookRule, payload: &Value) -> RuleEvaluation {
    if !rule.enabled {
        return RuleEvaluation {
            rule_id: rule.id.clone(),
            rule_name: rule.name.clone(),
            enabled: false,
            skipped: true,
            matched: false,
            conditions: Vec::new(),
        };
    }

    let conditions: Vec<ConditionEvaluation> = rule
        .conditions
        .iter()
        .map(|c| evaluate_condition_verbose(c, payload))
        .collect();

    let matched = !conditions.is_empty()
        && match rule.condition_logic {
            ConditionLogic::All => conditions.iter().all(|c| c.passed),
            ConditionLogic::Any => conditions.iter().any(|c| c.passed),
        };

    RuleEvaluation {
        rule_id: rule.id.clone(),
        rule_name: rule.name.clone(),
        enabled: rule.enabled,
        skipped: false,
        matched,
        conditions,
    }
}

pub fn evaluate_rule(rule: &WebhookRule, payload: &Value) -> bool {
    evaluate_rule_verbose(rule, payload).matched
}

/// Replace "{field.path}" placeholders in a template with values extracted
/// from the payload. Unresolvable paths become empty strings.
pub fn substitute_placeholders(template: &str, payload: &Value) -> String {
    let mut result = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find('{') {
        result.push_str(&rest[..start]);
        match rest[start..].find('}') {
            Some(end) => {
                let path = &rest[start + 1..start + end];
                if path.is_empty() || path.contains('{') || path.contains(' ') {
                    result.push_str(&rest[start..=start + end]);
                } else {
                    result.push_str(&extract_field_as_string(payload, path).unwrap_or_default());
                }
                rest = &rest[start + end + 1..];
            }
            None => {
                result.push_str(&rest[start..]);
                rest = "";
            }
        }
    }

    result.push_str(rest);
    result
}

/// Validate a rule. Returns a human-readable error message on failure.
pub fn validate_rule(rule: &WebhookRule) -> Result<(), String> {
    if rule.name.trim().is_empty() {
        return Err("Rule name is required".to_string());
    }
    if rule.conditions.is_empty() {
        return Err(
            "Rule must have at least one condition (use the webhook's default actions for a catch-all)"
                .to_string(),
        );
    }
    if rule.actions.is_empty() {
        return Err("Rule must have at least one action".to_string());
    }
    for (i, condition) in rule.conditions.iter().enumerate() {
        if condition.field_path.trim().is_empty() {
            return Err(format!("Condition {}: field_path is required", i + 1));
        }
    }
    for (i, action) in rule.actions.iter().enumerate() {
        validate_action(action).map_err(|e| format!("Action {}: {}", i + 1, e))?;
    }
    Ok(())
}

/// Validate the required parameters for an action type.
pub fn validate_action(action: &WebhookAction) -> Result<(), String> {
    let has = |key: &str| {
        action
            .parameters
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    };

    match action.action_type {
        ActionType::DisplayImage => {
            let source = action
                .parameters
                .get("image_source")
                .and_then(|v| v.as_str())
                .unwrap_or("url");
            match source {
                "url" => {
                    // url/url_field are optional here — the action executor
                    // falls back to the webhook's image_url_field at runtime.
                }
                "base64" => {
                    if !has("base64_data") {
                        return Err("DisplayImage with base64 source requires 'base64_data'".to_string());
                    }
                }
                "template" => {}
                "text_overlay" => {
                    if !has("base_image_url") {
                        return Err("DisplayImage with text_overlay source requires 'base_image_url'".to_string());
                    }
                }
                other => return Err(format!("Unsupported image_source: '{}'", other)),
            }
        }
        ActionType::ForwardWebhook => {
            if !has("url") {
                return Err("ForwardWebhook requires a 'url' parameter".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod extract_field_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn selects_array_element_by_field_value() {
        let payload = json!({ "series": { "images": [
            { "coverType": "banner", "remoteUrl": "b.jpg" },
            { "coverType": "poster", "remoteUrl": "p.jpg" },
        ]}});
        assert_eq!(
            extract_field_as_string(&payload, "series.images[coverType=poster].remoteUrl").as_deref(),
            Some("p.jpg")
        );
        assert_eq!(extract_field(&payload, "series.images[coverType=logo].remoteUrl"), None);
        assert_eq!(
            extract_field_as_string(&payload, "series.images[0].remoteUrl").as_deref(),
            Some("b.jpg")
        );
    }
}
