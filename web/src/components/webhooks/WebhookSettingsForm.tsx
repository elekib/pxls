"use client";

// Ported from the original Vite UI (frontend/src on the `rust-prerelease` branch) as-is.

import { useState } from 'react';
import { DISPLAY_MODES, ICON_PRESETS, PRESET_COLORS } from '@/ui/webhooks/schema';
import type { DisplayMode, Webhook } from '@/ui/webhooks/types';
import { btn, Field, inputClass, Toggle } from './ui';
import { sortAlpha } from '@/ui/sort';

interface Props {
  webhook: Webhook;
  busy: boolean;
  onSave: (patch: Partial<Webhook>) => Promise<boolean>;
  onCancel: () => void;
}

const num = (v: string, fallback: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function WebhookSettingsForm({ webhook, busy, onSave, onCancel }: Props) {
  const [form, setForm] = useState<Webhook>(webhook);
  const set = <K extends keyof Webhook>(key: K, value: Webhook[K]) => setForm((f) => ({ ...f, [key]: value }));

  const pathProblem = /^[A-Za-z0-9_-]+$/.test(form.path) ? null : 'Use letters, numbers, - and _ only';
  const invalid = !form.name.trim() || !!pathProblem;

  const save = async () => {
    // Rules are managed from the rules panel; don't overwrite them with this form's snapshot
    const patch = Object.fromEntries(
      Object.entries(form).filter(([k]) => k !== 'rules' && k !== 'default_actions'),
    ) as Partial<Webhook>;
    if (await onSave(patch)) onCancel();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} /></Field>
        <Field label="URL path" hint={pathProblem ?? 'Changing this changes the URL your services post to'}>
          <input value={form.path} onChange={(e) => set('path', e.target.value)} className={`${inputClass} ${pathProblem ? 'border-red-500' : ''}`} />
        </Field>
        <Field label="Events to keep"><input type="number" min={1} value={form.max_events} onChange={(e) => set('max_events', num(e.target.value, 100))} className={inputClass} /></Field>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-300">
        <label className="flex items-center gap-2"><Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" /> Enabled</label>
        <label className="flex items-center gap-2"><Toggle checked={form.log_events} onChange={(v) => set('log_events', v)} label="Log events" /> Log events</label>
        <label className="flex items-center gap-2"><Toggle checked={form.display_on_no_match} onChange={(v) => set('display_on_no_match', v)} label="Show default when no rule matches" /> Show default display when no rule matches</label>
      </div>

      <div className="border-t border-gray-700 pt-4">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Default display <span className="text-gray-500 font-normal">(used when no rule matches, and inherited by rule actions)</span></h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Display mode">
            <select value={form.display_mode} onChange={(e) => set('display_mode', e.target.value as DisplayMode)} className={inputClass}>
              {sortAlpha(DISPLAY_MODES, (m) => m.label).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Background">
            <ColorSelect value={form.background_color} onChange={(v) => set('background_color', v)} />
          </Field>
          <Field label="Text color">
            <ColorSelect value={form.text_color} onChange={(v) => set('text_color', v)} />
          </Field>
          <Field label="Duration (sec)"><input type="number" min={1} value={form.duration_secs} onChange={(e) => set('duration_secs', num(e.target.value, 10))} className={inputClass} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <Field label="Title field" hint="Payload path, e.g. movie.title"><input value={form.title_field} onChange={(e) => set('title_field', e.target.value)} className={inputClass} /></Field>
          <Field label="Subtitle field" hint="Payload path, e.g. eventType"><input value={form.subtitle_field} onChange={(e) => set('subtitle_field', e.target.value)} className={inputClass} /></Field>
        </div>
        {form.display_mode === 'image' && (
          <div className="mt-4">
            <Field label="Image URL field" hint="Payload path containing the image URL"><input value={form.image_url_field} onChange={(e) => set('image_url_field', e.target.value)} className={inputClass} /></Field>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-300"><Toggle checked={form.flash} onChange={(v) => set('flash', v)} label="Flash" /> Flash</label>
          {form.flash && (
            <div className="w-40"><Field label="Flash speed (ms)"><input type="number" min={1} value={form.flash_speed_ms} onChange={(e) => set('flash_speed_ms', num(e.target.value, 500))} className={inputClass} /></Field></div>
          )}
        </div>
        <div className="mt-4">
          <span className="block text-sm text-gray-400 mb-2">Icon</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => set('icon', '')} className={`px-3 py-2 rounded-lg border text-sm text-gray-400 ${form.icon === '' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-gray-800 border-gray-700 hover:bg-gray-700'}`}>None</button>
            {ICON_PRESETS.map((p) => (
              <button key={p.emoji} type="button" title={p.label} onClick={() => set('icon', p.emoji)} className={`px-3 py-2 rounded-lg border text-xl ${form.icon === p.emoji ? 'bg-cyan-600 border-cyan-500' : 'bg-gray-800 border-gray-700 hover:bg-gray-700'}`}>{p.emoji}</button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <Field label="Icon image URL (optional)" hint="Replaces the text icon; resized to 8x8">
            <input value={form.icon_image_url} onChange={(e) => set('icon_image_url', e.target.value)} placeholder="https://example.com/icon.png" className={inputClass} />
          </Field>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={busy || invalid} className={btn.primary}>Save</button>
        <button onClick={onCancel} className={btn.secondary}>Cancel</button>
      </div>
    </div>
  );
}

function ColorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = PRESET_COLORS.some((c) => c.value === value);
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded border border-gray-600 shrink-0" style={{ backgroundColor: `#${value}` }} />
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {!known && <option value={value}>#{value}</option>}
        {sortAlpha(PRESET_COLORS, (c) => c.label).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    </div>
  );
}
