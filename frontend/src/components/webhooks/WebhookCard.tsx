import { useEffect, useMemo, useState } from 'react';
import { errorMessage, eventApi, webhookApi } from '../../webhooks/api';
import { flattenPaths, GENERIC_SAMPLE, presetFor, prettyJson } from '../../webhooks/schema';
import type { Webhook, WebhookSummary } from '../../webhooks/types';
import type { useWebhooks } from '../../webhooks/useWebhooks';
import { RulesPanel } from './RulesPanel';
import { WebhookSettingsForm } from './WebhookSettingsForm';
import { Badge, btn, CopyButton, relativeTime, Toggle, webhookUrl, webhookUrlWithSecret } from './ui';

type Store = ReturnType<typeof useWebhooks>;
type Notify = (message: string, type?: 'success' | 'error') => void;

interface Props {
  webhook: Webhook;
  summary?: WebhookSummary;
  store: Store;
  onNotify: Notify;
}

export function WebhookCard({ webhook, summary, store, onNotify }: Props) {
  const [editing, setEditing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [knownFields, setKnownFields] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const preset = useMemo(() => presetFor(webhook.name, webhook.path), [webhook.name, webhook.path]);
  const url = webhookUrl(webhook.path);

  // Offer field names from real recent payloads when editing rules
  useEffect(() => {
    if (!rulesOpen) return;
    let cancelled = false;
    eventApi.list(webhook.name, 5).then((events) => {
      if (cancelled) return;
      const paths = new Set<string>();
      events.forEach((e) => flattenPaths(e.payload, '', paths));
      preset?.samples.forEach((s) => flattenPaths(s.payload, '', paths));
      setKnownFields([...paths].sort());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [rulesOpen, webhook.name, preset]);

  const sendTest = async () => {
    // A real delivery: it runs the actions, so the user sees it on the device
    // Prefer a sample that one of this webhook's enabled rules actually matches;
    // a bare "Test" event is ignored when no rule covers it.
    const covered = new Set(
      webhook.rules.filter((r) => r.enabled).flatMap((r) =>
        r.conditions
          .filter((c) => c.operator === 'Equals' && c.field_path === preset?.eventField)
          .map((c) => String(c.value))),
    );
    const payload =
      preset?.samples.find((s) => covered.has(String((s.payload as Record<string, unknown>)[preset.eventField]))
      )?.payload
      ?? preset?.samples.find((s) => s.label === 'Test')?.payload
      ?? GENERIC_SAMPLE;
    if (!confirm(`Send this test delivery to '${webhook.name}'? It will show on the device.\n\n${prettyJson(payload)}`)) return;
    setSending(true);
    try {
      const { status, data } = await webhookApi.deliver(webhook.path, payload, webhook.secret);
      if (status >= 200 && status < 300 && data.processed === false) {
        onNotify(`Delivered, but nothing ran: ${data.message ?? 'no rule matched'}. Add a rule for this event or turn on "show default display".`, 'error');
      } else if (status >= 200 && status < 300) onNotify(`Test sent: ${data.message ?? 'ok'}`, 'success');
      else onNotify(`Test failed: ${data.error ?? data.message ?? status}`, 'error');
      store.refreshSummary();
    } catch (e) {
      onNotify(`Test failed: ${errorMessage(e)}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const remove = () => {
    if (confirm(`Delete webhook '${webhook.name}' and its ${webhook.rules.length} rule(s)? This cannot be undone.`)) {
      store.removeWebhook(webhook.name);
    }
  };

  return (
    <div className={`bg-gray-900 rounded-lg p-4 border border-gray-700 ${webhook.enabled ? '' : 'opacity-75'}`}>
      {editing ? (
        <WebhookSettingsForm
          webhook={webhook}
          busy={store.busy}
          onSave={(patch) => store.saveWebhook(webhook.name, patch)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Toggle checked={webhook.enabled} disabled={store.busy} label={webhook.enabled ? 'Disable webhook' : 'Enable webhook'} onChange={(v) => store.setEnabled(webhook, v)} />
                <span className="font-medium">{webhook.icon} {webhook.name}</span>
                {!webhook.enabled && <Badge>disabled</Badge>}
                <Badge tone="purple">{webhook.rules.length} rule{webhook.rules.length === 1 ? '' : 's'}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                <code className="text-gray-300 break-all">POST {url}</code>
                <CopyButton text={url} label="Copy URL" />
              </div>
              {webhook.secret && (
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>Senders must authenticate with this webhook's secret:</span>
                  <CopyButton text={webhook.secret} label="Copy secret" />
                  <CopyButton text={webhookUrlWithSecret(webhook.path, webhook.secret)} label="Copy URL with secret" />
                  <span className="text-gray-500">
                    (header <code>X-Webhook-Secret</code>, Basic auth password, or <code>?secret=</code>)
                  </span>
                </div>
              )}
              <div className="mt-2 text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-1 items-center">
                {summary?.last_timestamp ? (
                  <>
                    <span>Last event {relativeTime(summary.last_timestamp)}</span>
                    {summary.last_error
                      ? <Badge tone="red" title={summary.last_error}>last failed</Badge>
                      : summary.last_processed === false
                        ? <Badge tone="yellow">last not matched</Badge>
                        : <Badge tone="green">last ok{summary.last_matched_rule ? ` · ${summary.last_matched_rule}` : ''}</Badge>}
                    <span>{summary.count} logged{summary.error_count > 0 && ` · ${summary.error_count} with errors`}</span>
                  </>
                ) : (
                  <span>No events received yet</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setRulesOpen((v) => !v)} className={`px-3 py-1 rounded text-sm transition-colors ${rulesOpen ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-700 hover:bg-gray-600'}`}>Rules {rulesOpen ? '▾' : '▸'}</button>
              <button onClick={sendTest} disabled={sending || !webhook.enabled} title={webhook.enabled ? 'Send a real test delivery' : 'Enable the webhook to test it'} className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors disabled:opacity-40">{sending ? 'Sending…' : 'Send test'}</button>
              <button onClick={() => setEditing(true)} className={btn.small}>Edit</button>
              <button onClick={() => store.cloneWebhook(webhook)} disabled={store.busy} className={btn.small} title="Clone with all rules">Clone</button>
              <button onClick={remove} className={btn.smallDanger} aria-label="Delete webhook">×</button>
            </div>
          </div>
          {!webhook.display_on_no_match && webhook.rules.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">Events that match no rule are ignored.</p>
          )}
        </>
      )}

      {rulesOpen && !editing && <RulesPanel webhook={webhook} store={store} preset={preset} knownFields={knownFields} />}
    </div>
  );
}
