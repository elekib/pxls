"use client";

// Ported from the original Vite UI (frontend/src on the `rust-prerelease` branch) as-is.

import { ACTION_TYPES, getActionParamFields, type ParamField } from '@/ui/webhooks/schema';
import type { Action, ActionType, ParamValue } from '@/ui/webhooks/types';
import { compactInputClass } from './ui';
import { sortAlpha } from '@/ui/sort';

interface Props {
  action: Action;
  onChange: (action: Action) => void;
  onRemove: () => void;
}

function ParamInput({ field, value, onChange }: { field: ParamField; value: ParamValue | undefined; onChange: (v: ParamValue | '') => void }) {
  const current = value ?? '';
  switch (field.type) {
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded" />;
    case 'number':
      return (
        <input
          type="number"
          placeholder={field.placeholder}
          value={current as number | ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={compactInputClass}
        />
      );
    case 'select': {
      const options = field.options ?? [];
      // Keep values set outside the preset list (e.g. a custom hex colour) visible
      const known = current === '' || options.some((o) => o.value === current);
      return (
        <select value={current as string} onChange={(e) => onChange(e.target.value)} className={compactInputClass}>
          <option value="">(inherit default)</option>
          {!known && <option value={current as string}>{String(current)}</option>}
          {sortAlpha(options, (o) => o.label).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    default:
      return <input type="text" placeholder={field.placeholder} value={current as string} onChange={(e) => onChange(e.target.value)} className={compactInputClass} />;
  }
}

export function ActionEditor({ action, onChange, onRemove }: Props) {
  const setType = (type: ActionType) => onChange({ action_type: type, parameters: {} });

  const setParam = (key: string, value: ParamValue | '') => {
    const parameters = { ...action.parameters };
    // Blanks fall back to the webhook defaults; an unchecked box is an explicit "off"
    if (value === '') delete parameters[key];
    else parameters[key] = value;
    onChange({ ...action, parameters });
  };

  const fields = getActionParamFields(action.action_type).filter((f) => !f.visibleWhen || f.visibleWhen(action.parameters));

  return (
    <div className="bg-gray-700 rounded p-3 mb-2">
      <div className="flex gap-2 mb-2">
        <select value={action.action_type} onChange={(e) => setType(e.target.value as ActionType)} className={compactInputClass}>
          {sortAlpha(ACTION_TYPES, (t) => t.label).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300 text-xs px-2">Remove</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="block text-xs text-gray-400 mb-1">{field.label}</span>
            <ParamInput field={field} value={action.parameters[field.key]} onChange={(v) => setParam(field.key, v)} />
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Blank fields inherit the webhook's display defaults. Use <code className="text-cyan-400">{'{field.path}'}</code> to insert payload values.
      </p>
    </div>
  );
}
