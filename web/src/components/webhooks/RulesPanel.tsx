"use client";

import { useMemo, useState } from 'react';
import { webhookApi, errorMessage } from '@/ui/webhooks/api';
import { describeAction, describeCondition, emptyRule, GENERIC_SAMPLE, prettyJson, type ServicePreset } from '@/ui/webhooks/schema';
import type { Rule, RuleTestResult, Webhook } from '@/ui/webhooks/types';
import type { useWebhooks } from '@/ui/webhooks/useWebhooks';
import { EvaluationView, PayloadEditor, parsePayload } from './PayloadTester';
import { RuleEditor } from './RuleEditor';
import { Badge, btn, Toggle } from './ui';
import { sortAlpha } from '@/ui/sort';
import { MdArrowDownward, MdArrowForward, MdArrowUpward, MdClose, MdContentCopy } from 'react-icons/md';

type Store = ReturnType<typeof useWebhooks>;

interface Props {
  webhook: Webhook;
  store: Store;
  preset?: ServicePreset;
  knownFields: string[];
}

interface EditorState { rule: Rule; originalKey: string | null }

export function RulesPanel({ webhook, store, preset, knownFields }: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [payloadText, setPayloadText] = useState(() => prettyJson(preset?.samples[0]?.payload ?? GENERIC_SAMPLE));
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Rules already covered by a template shouldn't be offered twice
  const missingTemplates = useMemo(
    () => (preset?.ruleTemplates ?? []).filter((t) => !webhook.rules.some((r) => r.name === t.rule.name)),
    [preset, webhook.rules],
  );

  const newRuleName = () => {
    let n = webhook.rules.length + 1;
    while (webhook.rules.some((r) => r.name === `rule_${n}`)) n += 1;
    return `rule_${n}`;
  };

  const runTest = async () => {
    const parsed = parsePayload(payloadText);
    if (parsed.error) { setTestError(`Invalid JSON: ${parsed.error}`); return; }
    setTesting(true);
    setTestError(null);
    try {
      setResult(await webhookApi.testRules(webhook.name, parsed.value));
    } catch (e) {
      setResult(null);
      setTestError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h4 className="text-sm font-semibold text-ink2">Rules</h4>
        <div className="flex flex-wrap gap-2">
          {webhook.rules.length > 0 && (
            <button onClick={() => setShowTest((v) => !v)} className={btn.small}>{showTest ? 'Close test' : 'Test all rules'}</button>
          )}
          {missingTemplates.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const t = missingTemplates.find((x) => x.label === e.target.value);
                if (t) setEditor({ rule: { ...t.rule, id: '' }, originalKey: null });
              }}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-sm text-ink2 hover:border-axis"
              aria-label="Add rule from template"
            >
              <option value="">+ From {preset?.label} template…</option>
              {sortAlpha(missingTemplates, (t) => t.label).map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
          )}
          <button onClick={() => setEditor({ rule: { ...emptyRule(), name: newRuleName() }, originalKey: null })} className={btn.smallPrimary}>+ Add rule</button>
        </div>
      </div>
      <p className="text-xs text-muted mb-3">
        Rules run top to bottom and the <strong>first match wins</strong>. Use the arrows to change priority.
      </p>

      {webhook.rules.length === 0 ? (
        <p className="text-sm text-muted">No rules yet. Every event uses the webhook's default display settings.</p>
      ) : (
        <ol className="space-y-2">
          {webhook.rules.map((rule, i) => (
            <li key={rule.id || rule.name} className={`bg-surface rounded p-3 border border-line ${rule.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col">
                  <button disabled={store.busy || i === 0} onClick={() => store.moveRule(webhook, i, -1)} aria-label="Move up" className="text-muted hover:text-ink disabled:opacity-20 leading-none px-1"><MdArrowUpward className="h-4 w-4" aria-hidden /></button>
                  <span className="text-xs text-muted text-center">{i + 1}</span>
                  <button disabled={store.busy || i === webhook.rules.length - 1} onClick={() => store.moveRule(webhook, i, 1)} aria-label="Move down" className="text-muted hover:text-ink disabled:opacity-20 leading-none px-1"><MdArrowDownward className="h-4 w-4" aria-hidden /></button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{rule.name}</span>
                    {!rule.enabled && <Badge>disabled</Badge>}
                  </div>
                  <div className="text-xs text-muted mt-1 break-words">
                    <span className="text-muted">When </span>
                    {rule.conditions.map(describeCondition).join(rule.condition_logic === 'Any' ? ' OR ' : ' AND ')}
                  </div>
                  <div className="text-xs text-muted break-words">
                    <span className="text-muted">Then </span>
                    {rule.actions.map((a, n) => (<span key={n} className={`inline-flex items-center gap-1 ${n > 0 ? "ml-1" : ""}`}>{n > 0 && <MdArrowForward className="h-3.5 w-3.5" aria-hidden />}{describeAction(a)}</span>))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Toggle checked={rule.enabled} label={rule.enabled ? 'Disable rule' : 'Enable rule'} disabled={store.busy} onChange={(v) => store.setRuleEnabled(webhook.name, rule, v)} />
                  <div className="flex gap-1">
                    <button onClick={() => setEditor({ rule, originalKey: rule.id || rule.name })} className={btn.small}>Edit</button>
                    <button disabled={store.busy} onClick={() => store.duplicateRule(webhook, rule)} className={btn.small} title="Duplicate" aria-label="Duplicate rule"><MdContentCopy className="h-4 w-4" aria-hidden /></button>
                    <button disabled={store.busy} onClick={() => confirm(`Delete rule '${rule.name}'?`) && store.deleteRule(webhook.name, rule)} className={btn.smallDanger} aria-label="Delete rule"><MdClose className="h-4 w-4" aria-hidden /></button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {showTest && (
        <div className="mt-4 p-3 bg-page rounded border border-line">
          <h5 className="text-sm font-semibold text-ink2 mb-2">Test all rules <span className="text-muted font-normal">(dry run)</span></h5>
          <PayloadEditor value={payloadText} onChange={setPayloadText} preset={preset} />
          <button onClick={runTest} disabled={testing} className={`mt-2 ${btn.smallPrimary}`}>{testing ? 'Testing…' : 'Run test'}</button>
          {testError && <p className="text-xs text-bad mt-2">{testError}</p>}
          {result && (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge tone={result.matched_rule ? 'green' : 'gray'}>{result.matched_rule ? `Would match: ${result.matched_rule}` : 'No rule would match'}</Badge>
                {!result.matched_rule && result.would_display_default && <Badge tone="blue">Would show default display</Badge>}
              </div>
              <EvaluationView evaluations={result.evaluations} />
            </div>
          )}
        </div>
      )}

      {editor && (
        <RuleEditor
          webhookName={webhook.name}
          initial={editor.rule}
          isNew={editor.originalKey === null}
          preset={preset}
          knownFields={knownFields}
          onSave={(rule) => store.saveRule(webhook.name, rule, editor.originalKey)}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
