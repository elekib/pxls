// Ported from the original Vite UI (frontend/src on main) as-is.

import { useCallback, useEffect, useRef, useState } from 'react';
import { eventApi, errorMessage, webhookApi } from './api';
import type { Rule, Webhook, WebhookSummary } from './types';

type Notify = (message: string, type?: 'success' | 'error') => void;

const SUMMARY_POLL_MS = 10_000;

/** Returns `base`, or `base_2`, `base_3`... so it collides with nothing in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Defaults for a new webhook; the backend fills in anything omitted. */
export function newWebhookDefaults(overrides: Partial<Webhook> = {}): Partial<Webhook> {
  return {
    enabled: true,
    log_events: true,
    max_events: 100,
    rules: [],
    default_actions: [],
    display_on_no_match: true,
    duration_secs: 10,
    display_mode: 'icon_only',
    background_color: 'FF0000',
    text_color: 'FFFFFF',
    title_field: 'title',
    subtitle_field: 'subtitle',
    flash: true,
    flash_speed_ms: 500,
    icon: '📺',
    icon_image_url: '',
    image_url_field: '',
    ...overrides,
  };
}

/** Owns webhook data, delivery summaries and all mutations for the management page. */
export function useWebhooks(onNotify: Notify) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [summary, setSummary] = useState<Record<string, WebhookSummary>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const webhooksRef = useRef(webhooks);
  webhooksRef.current = webhooks;

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await eventApi.summary());
    } catch {
      // Summary is decorative; keep the last known values.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setWebhooks(await webhookApi.list());
    } catch (e) {
      onNotify(`Failed to load webhooks: ${errorMessage(e)}`, 'error');
    } finally {
      setLoading(false);
    }
    refreshSummary();
  }, [onNotify, refreshSummary]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refreshSummary, SUMMARY_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, refreshSummary]);

  /** Run a mutation, then reload and report. Resolves true on success. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        await refresh();
        if (success) onNotify(success, 'success');
        return true;
      } catch (e) {
        onNotify(errorMessage(e), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onNotify, refresh],
  );

  const takenNames = () => webhooksRef.current.flatMap((w) => [w.name, w.path]);

  const addWebhook = (base = 'webhook', overrides: Partial<Webhook> = {}) => {
    const name = uniqueName(base, takenNames());
    return mutate(
      () => webhookApi.create(newWebhookDefaults({ ...overrides, name, path: name })),
      `Created webhook '${name}'`,
    );
  };

  const saveWebhook = (name: string, patch: Partial<Webhook>) =>
    mutate(() => webhookApi.update(name, patch), 'Webhook saved');

  const setEnabled = (webhook: Webhook, enabled: boolean) =>
    mutate(() => webhookApi.update(webhook.name, { enabled }));

  const removeWebhook = (name: string) =>
    mutate(() => webhookApi.remove(name), `Deleted '${name}'`);

  const cloneWebhook = (source: Webhook) => {
    const name = uniqueName(`${source.name}_copy`, takenNames());
    const copy: Partial<Webhook> = {
      ...source,
      name,
      path: name,
      // Fresh ids so the copy's rules are independent of the original's
      rules: source.rules.map((r) => ({ ...r, id: '' })),
    };
    return mutate(() => webhookApi.create(copy), `Cloned to '${name}'`);
  };

  /** Create webhooks from an exported file. Conflicts are skipped, not overwritten. */
  const importWebhooks = async (incoming: Partial<Webhook>[]): Promise<void> => {
    const taken = new Set(takenNames());
    let created = 0;
    const skipped: string[] = [];
    const failed: string[] = [];

    setBusy(true);
    for (const w of incoming) {
      const label = w.name || w.path || '(unnamed)';
      if (!w.name || taken.has(w.name) || (w.path && taken.has(w.path))) {
        skipped.push(label);
        continue;
      }
      try {
        await webhookApi.create(newWebhookDefaults(w));
        taken.add(w.name);
        if (w.path) taken.add(w.path);
        created += 1;
      } catch (e) {
        failed.push(`${label} (${errorMessage(e)})`);
      }
    }
    await refresh();
    setBusy(false);

    const parts = [`Imported ${created}`];
    if (skipped.length) parts.push(`skipped ${skipped.length} existing: ${skipped.join(', ')}`);
    if (failed.length) parts.push(`failed: ${failed.join('; ')}`);
    onNotify(parts.join(' · '), failed.length ? 'error' : 'success');
  };

  // ---- Rules ---------------------------------------------------------------

  const saveRule = (webhook: string, rule: Rule, originalKey: string | null) =>
    mutate(
      () =>
        originalKey
          ? webhookApi.updateRule(webhook, originalKey, rule)
          : webhookApi.createRule(webhook, rule),
      originalKey ? 'Rule updated' : 'Rule created',
    );

  const deleteRule = (webhook: string, rule: Rule) =>
    mutate(() => webhookApi.deleteRule(webhook, rule.id || rule.name), `Deleted rule '${rule.name}'`);

  const setRuleEnabled = (webhook: string, rule: Rule, enabled: boolean) =>
    mutate(() => webhookApi.updateRule(webhook, rule.id || rule.name, { ...rule, enabled }));

  const duplicateRule = (webhook: Webhook, rule: Rule) => {
    const name = uniqueName(`${rule.name}_copy`, webhook.rules.map((r) => r.name));
    return mutate(
      () => webhookApi.createRule(webhook.name, { ...rule, id: '', name }),
      `Duplicated as '${name}'`,
    );
  };

  /** Move a rule up (-1) or down (+1); order decides which rule wins. */
  const moveRule = (webhook: Webhook, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= webhook.rules.length) return Promise.resolve(false);
    const order = webhook.rules.map((r) => r.id || r.name);
    [order[index], order[target]] = [order[target], order[index]];
    return mutate(() => webhookApi.reorderRules(webhook.name, order));
  };

  return {
    webhooks, summary, loading, busy,
    refresh, refreshSummary,
    addWebhook, saveWebhook, setEnabled, removeWebhook, cloneWebhook, importWebhooks,
    saveRule, deleteRule, setRuleEnabled, duplicateRule, moveRule,
  };
}
