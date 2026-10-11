"use client";

import { useRef } from 'react';
import { SERVICE_PRESETS } from '@/ui/webhooks/schema';
import type { Webhook } from '@/ui/webhooks/types';
import type { useWebhooks } from '@/ui/webhooks/useWebhooks';
import { btn } from './ui';
import { sortAlpha } from '@/ui/sort';

type Store = ReturnType<typeof useWebhooks>;
type Notify = (message: string, type?: 'success' | 'error') => void;

export function WebhookToolbar({ store, onNotify }: { store: Store; onNotify: Notify }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ webhooks: store.webhooks.map(({ secret: _secret, ...rest }) => rest) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pxls-webhooks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const list: Partial<Webhook>[] | undefined = Array.isArray(data) ? data : data?.webhooks;
      if (!Array.isArray(list)) throw new Error('expected {"webhooks": [...]}');
      await store.importWebhooks(list);
    } catch (e) {
      onNotify(`Import failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value=""
        disabled={store.busy}
        aria-label="Add webhook"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'blank') store.addWebhook();
          else {
            const p = SERVICE_PRESETS.find((x) => x.id === v);
            if (p) store.addWebhook(p.path, { icon: p.icon, title_field: p.titleField, subtitle_field: p.subtitleField, display_mode: 'icon_with_text' });
          }
        }}
        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg font-medium disabled:opacity-50"
      >
        <option value="">+ Add webhook…</option>
        <option value="blank">Blank webhook</option>
        {sortAlpha(SERVICE_PRESETS, (p) => p.label).map((p) => <option key={p.id} value={p.id}>{p.label} preset</option>)}
      </select>
      <button onClick={exportAll} disabled={store.webhooks.length === 0} className={btn.secondary}>Export</button>
      <button onClick={() => fileRef.current?.click()} disabled={store.busy} className={btn.secondary}>Import</button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) importFile(f);
        }}
      />
    </div>
  );
}
