"use client";

// Ported from the original Vite UI (frontend/src on the `rust-prerelease` branch) as-is.

import { useMemo, useState } from 'react';
import { webhookApi, errorMessage } from '@/ui/webhooks/api';
import { emptyAction, emptyCondition, prettyJson, validateRule, type ServicePreset } from '@/ui/webhooks/schema';
import type { Condition, Rule, RuleTestResult } from '@/ui/webhooks/types';
import { ActionEditor } from './ActionEditor';
import { ConditionEditor } from './ConditionEditor';
import { EvaluationView, PayloadEditor, parsePayload } from './PayloadTester';
import { Badge, btn, compactInputClass, Modal } from './ui';

interface Props {
  webhookName: string;
  /** Rule being edited, or a template / blank rule for a new one. */
  initial: Rule;
  isNew: boolean;
  preset?: ServicePreset;
  /** Payload field paths seen in recent events, offered as autocomplete. */
  knownFields: string[];
  onSave: (rule: Rule) => Promise<boolean>;
  onClose: () => void;
}

const FIELD_LIST_ID = 'rule-editor-known-fields';

export function RuleEditor({ webhookName, initial, isNew, preset, knownFields, onSave, onClose }: Props) {
  const [rule, setRule] = useState<Rule>(initial);
  const [saving, setSaving] = useState(false);
  const [payloadText, setPayloadText] = useState(() => prettyJson(preset?.samples[0]?.payload ?? { title: 'Test' }));
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const problem = useMemo(() => validateRule(rule), [rule]);
  const dirty = useMemo(() => JSON.stringify(rule) !== JSON.stringify(initial), [rule, initial]);

  const patch = (p: Partial<Rule>) => setRule((r) => ({ ...r, ...p }));
  const setCondition = (i: number, c: Condition) => patch({ conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });

  const close = () => {
    if (!dirty || confirm('Discard unsaved changes to this rule?')) onClose();
  };

  const save = async () => {
    setSaving(true);
    const ok = await onSave(rule);
    setSaving(false);
    if (ok) onClose();
  };

  const runTest = async () => {
    const parsed = parsePayload(payloadText);
    if (parsed.error) { setTestError(`Invalid JSON: ${parsed.error}`); return; }
    setTesting(true);
    setTestError(null);
    try {
      setResult(await webhookApi.testRules(webhookName, parsed.value, rule));
    } catch (e) {
      setResult(null);
      setTestError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Create Rule' : 'Edit Rule'}
      onClose={close}
      footer={
        <>
          {problem && <span className="mr-auto self-center text-xs text-yellow-500">{problem}</span>}
          <button onClick={close} className={btn.secondary}>Cancel</button>
          <button onClick={save} disabled={!!problem || saving} className={btn.primary}>{saving ? 'Saving…' : 'Save Rule'}</button>
        </>
      }
    >
      <datalist id={FIELD_LIST_ID}>{knownFields.map((f) => <option key={f} value={f} />)}</datalist>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <label className="sm:col-span-2 block">
          <span className="block text-sm text-gray-400 mb-1">Rule Name</span>
          <input type="text" value={rule.name} onChange={(e) => patch({ name: e.target.value })} className={compactInputClass} />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-400 mb-1">Match</span>
          <select value={rule.condition_logic} onChange={(e) => patch({ condition_logic: e.target.value as Rule['condition_logic'] })} className={compactInputClass}>
            <option value="All">All conditions (AND)</option>
            <option value="Any">Any condition (OR)</option>
          </select>
        </label>
      </div>

      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-300">When…</h4>
          <button type="button" onClick={() => patch({ conditions: [...rule.conditions, emptyCondition()] })} className={btn.smallPrimary}>+ Condition</button>
        </div>
        {rule.conditions.map((c, i) => (
          <ConditionEditor
            key={i}
            condition={c}
            fieldListId={FIELD_LIST_ID}
            onChange={(next) => setCondition(i, next)}
            onRemove={() => patch({ conditions: rule.conditions.filter((_, j) => j !== i) })}
          />
        ))}
      </section>

      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-300">Then…</h4>
          <button type="button" onClick={() => patch({ actions: [...rule.actions, emptyAction()] })} className={btn.smallPrimary}>+ Action</button>
        </div>
        {rule.actions.map((a, i) => (
          <ActionEditor
            key={i}
            action={a}
            onChange={(next) => patch({ actions: rule.actions.map((x, j) => (j === i ? next : x)) })}
            onRemove={() => patch({ actions: rule.actions.filter((_, j) => j !== i) })}
          />
        ))}
      </section>

      <section className="p-3 bg-gray-900 rounded border border-gray-700">
        <h5 className="text-sm font-semibold text-gray-300 mb-2">Test this rule <span className="text-gray-500 font-normal">(dry run — nothing is shown on the device)</span></h5>
        <PayloadEditor value={payloadText} onChange={setPayloadText} preset={preset} rows={5} />
        <button onClick={runTest} disabled={testing} className={`mt-2 ${btn.smallPrimary}`}>{testing ? 'Testing…' : 'Run test'}</button>
        {testError && <p className="text-xs text-red-400 mt-2">{testError}</p>}
        {result && (
          <div className="mt-3">
            <div className="mb-2 flex gap-2">
              <Badge tone={result.matched ? 'green' : 'red'}>{result.matched ? 'MATCHED' : 'NOT MATCHED'}</Badge>
              {result.validation_error && <Badge tone="yellow">{result.validation_error}</Badge>}
            </div>
            <EvaluationView evaluations={result.evaluations} />
          </div>
        )}
      </section>
    </Modal>
  );
}
