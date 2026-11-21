"use client";

import { useMemo } from 'react';
import { prettyJson, type ServicePreset } from '@/ui/webhooks/schema';
import type { RuleEvaluation } from '@/ui/webhooks/types';
import { Badge } from './ui';
import { MdArrowForward, MdCheck, MdClose } from 'react-icons/md';

/** Returns the parsed payload, or an error message when the text isn't valid JSON. */
export function parsePayload(text: string): { value: unknown; error: null } | { value: null; error: string } {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

interface PayloadEditorProps {
  value: string;
  onChange: (text: string) => void;
  preset?: ServicePreset;
  rows?: number;
}

/** JSON textarea with live validation and one-click sample payloads. */
export function PayloadEditor({ value, onChange, preset, rows = 6 }: PayloadEditorProps) {
  const parsed = useMemo(() => parsePayload(value), [value]);
  return (
    <div>
      {preset && (
        <div className="flex flex-wrap items-center gap-1 mb-2">
          <span className="text-xs text-muted mr-1">{preset.label} samples:</span>
          {preset.samples.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onChange(prettyJson(s.payload))}
              className="px-2 py-0.5 border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink rounded text-xs transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        className={`w-full px-2 py-1 bg-surface border rounded text-white text-xs font-mono ${
          parsed.error ? 'border-bad' : 'border-line'
        }`}
      />
      {parsed.error && <p className="text-xs text-bad mt-1">Invalid JSON: {parsed.error}</p>}
    </div>
  );
}

export function EvaluationView({ evaluations }: { evaluations: RuleEvaluation[] }) {
  return (
    <div className="space-y-2">
      {evaluations.map((ev, i) => (
        <div key={i} className="p-2 bg-surface rounded text-xs">
          <div className="flex items-center gap-2 font-medium">
            {ev.rule_name}
            {ev.skipped ? <Badge>disabled</Badge> : <Badge tone={ev.matched ? 'green' : 'gray'}>{ev.matched ? 'match' : 'no match'}</Badge>}
          </div>
          {!ev.skipped && ev.conditions.map((c, j) => (
            <div key={j} className={`mt-1 font-mono ${c.passed ? 'text-good' : 'text-bad'}`}>
              {c.passed ? <MdCheck className="inline h-4 w-4" aria-label="passed" /> : <MdClose className="inline h-4 w-4" aria-label="failed" />} {c.field_path} {c.operator} {JSON.stringify(c.expected)} <MdArrowForward className="inline h-3.5 w-3.5" aria-label="gives" /> {c.actual === null || c.actual === undefined ? 'null' : JSON.stringify(c.actual)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
