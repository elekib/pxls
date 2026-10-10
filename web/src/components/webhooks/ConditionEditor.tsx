"use client";

// Ported from the original Vite UI (frontend/src on main) as-is.

import { OPERATORS, OPERATORS_WITHOUT_VALUE } from '@/ui/webhooks/schema';
import type { Condition, ConditionOperator } from '@/ui/webhooks/types';
import { compactInputClass } from './ui';
import { sortAlpha } from '@/ui/sort';

interface Props {
  condition: Condition;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  /** Datalist id of known payload fields, for autocomplete. */
  fieldListId?: string;
}

export function ConditionEditor({ condition, onChange, onRemove, fieldListId }: Props) {
  const needsValue = !OPERATORS_WITHOUT_VALUE.has(condition.operator);
  const value = typeof condition.value === 'string' ? condition.value : condition.value == null ? '' : JSON.stringify(condition.value);

  return (
    <div className="bg-gray-700 rounded p-3 mb-2">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-2">
        <input
          type="text"
          list={fieldListId}
          placeholder="Field path (e.g. eventType, movie.title)"
          value={condition.field_path}
          onChange={(e) => onChange({ ...condition, field_path: e.target.value })}
          className={`sm:col-span-4 ${compactInputClass}`}
        />
        <select
          value={condition.operator}
          onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator })}
          className={`sm:col-span-3 ${compactInputClass}`}
        >
          {sortAlpha(OPERATORS, (op) => op.label).map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
        {needsValue ? (
          <input
            type="text"
            placeholder="Value"
            value={value}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className={`sm:col-span-5 ${compactInputClass}`}
          />
        ) : (
          <div className="sm:col-span-5" />
        )}
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={condition.case_insensitive} onChange={(e) => onChange({ ...condition, case_insensitive: e.target.checked })} className="w-3 h-3 rounded" />
          Case-insensitive
        </label>
        <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
      </div>
    </div>
  );
}
