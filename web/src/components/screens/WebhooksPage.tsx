"use client";

import { WebhookCard } from '@/components/webhooks/WebhookCard';
import { WebhookToolbar } from '@/components/webhooks/WebhookToolbar';
import { useWebhooks } from '@/ui/webhooks/useWebhooks';

interface WebhooksPageProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export function WebhooksPage({ onNotify }: WebhooksPageProps) {
  const store = useWebhooks(onNotify);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Webhooks</h1>
        <WebhookToolbar store={store} onNotify={onNotify} />
      </div>

      <div className="bg-gray-800 rounded-xl p-6">
        <p className="text-gray-400 mb-4 text-sm">
          Each webhook is an endpoint that services like Radarr, Sonarr or Overseerr post to. Add rules to react to
          specific events; use <code className="text-cyan-400">{'{field.path}'}</code> placeholders in action
          fields to pull values from the payload. Pick a preset when adding a webhook to get the right fields and
          sample payloads. Past deliveries are on the Event Logs tab.
        </p>

        {store.loading ? (
          <div className="text-center py-8 text-gray-500">Loading webhooks…</div>
        ) : store.webhooks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No webhooks yet. Use “Add webhook…” and pick a preset to get started.</div>
        ) : (
          <div className="space-y-4">
            {store.webhooks.map((w) => (
              <WebhookCard key={w.name} webhook={w} summary={store.summary[w.name]} store={store} onNotify={onNotify} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
