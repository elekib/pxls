"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PayloadEditor, parsePayload } from '@/components/webhooks/PayloadTester';
import { Badge, btn, CopyButton, Field, inputClass, relativeTime } from '@/components/webhooks/ui';
import { errorMessage, eventApi, webhookApi } from '@/ui/webhooks/api';
import { prettyJson, presetFor } from '@/ui/webhooks/schema';
import type { DeliveryResult, Webhook, WebhookEvent } from '@/ui/webhooks/types';
import { sortAlpha } from '@/ui/sort';

interface WebhookEventsPageProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type StatusFilter = 'all' | 'matched' | 'default' | 'ignored' | 'error';
const POLL_MS = 5000;

function classify(e: WebhookEvent): Exclude<StatusFilter, 'all'> {
  if (e.error) return 'error';
  if (e.matched_rule) return 'matched';
  return e.processed ? 'default' : 'ignored';
}

function StatusBadge({ event }: { event: WebhookEvent }) {
  switch (classify(event)) {
    case 'error': return <Badge tone="red">Error</Badge>;
    case 'matched': return <Badge tone="green">Rule: {event.matched_rule}</Badge>;
    case 'default': return <Badge tone="blue">Default display</Badge>;
    default: return <Badge tone="yellow">Ignored</Badge>;
  }
}

export function WebhookEventsPage({ onNotify }: WebhookEventsPageProps) {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWebhook, setSelectedWebhook] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [limit, setLimit] = useState(50);
  const [auto, setAuto] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replaying, setReplaying] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [showSender, setShowSender] = useState(false);
  const [testTarget, setTestTarget] = useState('');
  const [testPayload, setTestPayload] = useState('{\n  "eventType": "Test",\n  "movie": { "title": "Test Movie" }\n}');
  const [sending, setSending] = useState(false);
  const [testResponse, setTestResponse] = useState<DeliveryResult | null>(null);

  const notifyRef = useRef(onNotify);
  notifyRef.current = onNotify;

  const fetchEvents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await eventApi.list(selectedWebhook, limit);
      // Keep identity when nothing changed so polling doesn't re-render or reset scroll
      setEvents((prev) =>
        prev.length === next.length && prev.every((e, i) => e.id === next[i].id && e.processed === next[i].processed && e.error === next[i].error)
          ? prev : next);
    } catch (e) {
      if (!silent) notifyRef.current(`Failed to fetch events: ${errorMessage(e)}`, 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedWebhook, limit]);

  useEffect(() => {
    webhookApi.list().then((list) => {
      setWebhooks(list);
      setTestTarget((t) => t || list[0]?.path || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchEvents();
    if (!auto) return;
    const timer = setInterval(() => { fetchEvents(true); setNow(Date.now()); }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchEvents, auto]);

  const visible = useMemo(() => (status === 'all' ? events : events.filter((e) => classify(e) === status)), [events, status]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    events.forEach((e) => { const k = classify(e); c[k] = (c[k] ?? 0) + 1; });
    return c;
  }, [events]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const clear = async () => {
    const what = selectedWebhook ? `'${selectedWebhook}'` : 'all webhooks';
    if (!confirm(`Clear logged events for ${what}?`)) return;
    try {
      await eventApi.clear(selectedWebhook || undefined);
      onNotify('Events cleared');
      fetchEvents();
    } catch (e) {
      onNotify(`Failed to clear events: ${errorMessage(e)}`, 'error');
    }
  };

  const replay = async (event: WebhookEvent) => {
    setReplaying(event.id);
    try {
      const data = await eventApi.replay(event.id);
      onNotify(`Replayed: ${data.message ?? 'ok'}`);
      setTimeout(() => fetchEvents(true), 400);
    } catch (e) {
      onNotify(`Replay failed: ${errorMessage(e)}`, 'error');
    } finally {
      setReplaying(null);
    }
  };

  const sendTest = async () => {
    const parsed = parsePayload(testPayload);
    if (parsed.error) return onNotify(`Invalid JSON: ${parsed.error}`, 'error');
    if (!testTarget) return onNotify('Select a webhook to test', 'error');
    setSending(true);
    setTestResponse(null);
    try {
      const res = await webhookApi.deliver(testTarget, parsed.value, webhooks.find((x) => (x.path || x.name) === testTarget)?.secret);
      setTestResponse(res);
      if (res.status >= 200 && res.status < 300) {
        onNotify(`Test sent to ${testTarget}: ${res.data.message ?? 'ok'}`);
        setTimeout(() => fetchEvents(true), 500);
      } else {
        onNotify(`Test failed: ${res.data.error ?? res.data.message ?? res.status}`, 'error');
      }
    } catch (e) {
      onNotify(`Failed to send test: ${errorMessage(e)}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const targetPreset = useMemo(() => {
    const w = webhooks.find((x) => (x.path || x.name) === testTarget);
    return w ? presetFor(w.name, w.path) : undefined;
  }, [webhooks, testTarget]);

  const statusTabs: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'matched', label: 'Matched' }, { id: 'default', label: 'Default' },
    { id: 'ignored', label: 'Ignored' }, { id: 'error', label: 'Errors' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Webhook Events</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="w-4 h-4 rounded" /> Auto-refresh
          </label>
          <button onClick={() => fetchEvents()} className={btn.primary}>Refresh</button>
          <button onClick={clear} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition-colors">Clear {selectedWebhook || 'all'}</button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Webhook">
            <select value={selectedWebhook} onChange={(e) => setSelectedWebhook(e.target.value)} className={inputClass}>
              <option value="">All webhooks</option>
              {sortAlpha(webhooks, (w) => w.name).map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="Show last">
            <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value, 10))} className={inputClass}>
              {[10, 25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {statusTabs.map((t) => (
            <button key={t.id} onClick={() => setStatus(t.id)} className={`px-3 py-1 rounded-full text-sm transition-colors ${status === t.id ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {t.label}{t.id === 'all' ? ` (${events.length})` : counts[t.id] ? ` (${counts[t.id]})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-4 sm:p-6">
        <button onClick={() => setShowSender((v) => !v)} className="text-lg font-semibold flex items-center gap-2">
          <span className="text-sm text-gray-400">{showSender ? '▾' : '▸'}</span> Send test webhook
        </button>
        {showSender && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-gray-500">This is a real delivery: matching actions run and show on the device. For a dry run use “Test all rules” on the Webhooks tab.</p>
            <div className="max-w-xs">
              <Field label="Target webhook">
                <select value={testTarget} onChange={(e) => setTestTarget(e.target.value)} className={inputClass}>
                  {sortAlpha(webhooks, (w) => w.name).map((w) => <option key={w.name} value={w.path || w.name}>{w.name}</option>)}
                </select>
              </Field>
            </div>
            <PayloadEditor value={testPayload} onChange={setTestPayload} preset={targetPreset} />
            <button onClick={sendTest} disabled={sending} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button>
            {testResponse && (
              <div className="p-3 bg-gray-900 rounded border border-gray-700 text-xs">
                <div className={`mb-2 font-medium ${testResponse.status < 300 ? 'text-green-400' : 'text-red-400'}`}>HTTP {testResponse.status}</div>
                <pre className="overflow-x-auto text-gray-300">{prettyJson(testResponse.data)}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-gray-800 rounded-xl p-4 sm:p-6">
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading events…</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {events.length === 0 ? 'No events logged yet. Send a test above, or trigger one from the service.' : 'No events match this filter.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((event) => {
              const open = expanded.has(event.id);
              const payload = prettyJson(event.payload);
              return (
                <li key={event.id} className="bg-gray-900 rounded-lg border border-gray-700">
                  <button onClick={() => toggle(event.id)} aria-expanded={open} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-gray-500 text-xs w-3">{open ? '▾' : '▸'}</span>
                    <StatusBadge event={event} />
                    <span className="font-medium text-cyan-400">{event.webhook_name}</span>
                    <span className="text-xs text-gray-400" title={new Date(event.timestamp).toLocaleString()}>{relativeTime(event.timestamp, now)}</span>
                    {!open && event.actions_taken[0] && <span className="text-xs text-gray-500 truncate min-w-0 flex-1">{event.actions_taken[0]}{event.actions_taken.length > 1 && ` (+${event.actions_taken.length - 1})`}</span>}
                  </button>
                  {open && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-700 pt-3">
                      <div className="text-xs text-gray-400">{new Date(event.timestamp).toLocaleString()} · <span className="font-mono">{event.id}</span></div>
                      {event.error && <div className="text-sm text-red-400">{event.error}</div>}
                      {event.actions_taken.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {event.actions_taken.map((a, i) => <Badge key={i} tone="blue">{a}</Badge>)}
                        </div>
                      )}
                      <pre className="bg-gray-800 p-3 rounded text-xs overflow-x-auto text-gray-300 max-h-80">{payload}</pre>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => replay(event)} disabled={replaying === event.id} className={btn.smallPrimary} title="Run this payload through the webhook again">{replaying === event.id ? 'Replaying…' : 'Replay'}</button>
                        <CopyButton text={payload} label="Copy payload" />
                        <button onClick={() => { setTestPayload(payload); setTestTarget(webhooks.find((w) => w.name === event.webhook_name)?.path ?? testTarget); setShowSender(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={btn.small}>Edit in test sender</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
