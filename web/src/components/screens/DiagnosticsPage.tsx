"use client";

import { useEffect, useState } from 'react';
import { accountRequest } from '@/ui/api';
import { MdMonitorHeart } from 'react-icons/md';

interface Props {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

interface Entry {
  hex: string;
  cmd: string;
  args: string;
  note: string;
}

const inputClass = 'px-3 py-2 bg-surface border border-line rounded-lg text-ink hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const btn = 'px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink disabled:opacity-50';

const hexByte = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Admin-only raw command sender for working out what a device accepts. */
export function DiagnosticsPage({ onNotify }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [cmd, setCmd] = useState('45');
  const [args, setArgs] = useState('03 00');
  const [resetFirst, setResetFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);

  // Sweep: sends `cmd <channel> <value>` for value from..to, one step at a time.
  const [channel, setChannel] = useState('03');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(15);
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    accountRequest<{ enabled: boolean }>('/api/debug/status')
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  const send = async (c: string, a: string) => {
    setBusy(true);
    try {
      const r = await accountRequest<{ sent: string }>('/api/debug/send', 'POST', {
        cmd: c,
        args: a,
        reset_first: resetFirst,
      });
      setLog((l) => [...l, { hex: r.sent, cmd: c, args: a, note: '' }]);
      return true;
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Send failed', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await accountRequest('/api/debug/release', 'POST', {});
      onNotify('Display restored to your configured mode');
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Restore failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const step = async (v: number) => {
    if (await send(cmd, `${channel} ${hexByte(v)}`)) setValue(v);
  };

  const results = log
    .map((e) => `${e.cmd} ${e.args} (${e.hex}): ${e.note || '-'}`)
    .join('\n');

  if (enabled === null) return <div className="text-muted">Loading...</div>;
  if (!enabled) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold">Diagnostics</h2>
        <div className="flex w-full flex-col items-center rounded-2xl border border-line bg-surface px-6 py-16 text-center shadow-card">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-surface2 text-muted" aria-hidden>
            <MdMonitorHeart className="h-7 w-7" />
          </span>
          <h3 className="mt-4 text-lg font-semibold">Diagnostics are off</h3>
          <p className="mt-1 max-w-md text-sm text-ink2">
            Raw device commands are disabled by default. Turn them on to probe the display.
          </p>
          <ol className="mt-5 space-y-2 text-left text-sm text-ink2">
            <li>
              1. Add <code className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-xs text-ink">PXLS_ENABLE_DEBUG=1</code> to{' '}
              <code className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-xs text-ink">.env</code>
            </li>
            <li>2. Restart pxls</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Diagnostics</h2>
        <p className="text-sm text-muted mt-1">
          Sends raw commands to the connected device (framing and checksum are added for you). Unknown commands may do
          unexpected things. While you probe, the display loop is paused for two minutes after each send.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-surface rounded-2xl border border-line shadow-card p-4">
        <button className={btn} disabled={busy} onClick={() => void restore()}>
          Restore display
        </button>
        <span className="text-xs text-muted">
          Ends the pause and puts the display back to your configured mode, for when a probe leaves it stuck.
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink2">
        <input type="checkbox" checked={resetFirst} onChange={(e) => setResetFirst(e.target.checked)} />
        Show solid red first, so an ignored command leaves the screen red
      </label>

      <section className="bg-surface rounded-2xl border border-line shadow-card p-4 space-y-3">
        <h3 className="font-medium">Raw command</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-muted">
            Command (hex)
            <input className={`${inputClass} block w-20`} value={cmd} onChange={(e) => setCmd(e.target.value)} />
          </label>
          <label className="text-xs text-muted flex-1 min-w-40">
            Arguments (hex)
            <input className={`${inputClass} block w-full`} value={args} onChange={(e) => setArgs(e.target.value)} />
          </label>
          <button className={btn} disabled={busy} onClick={() => void send(cmd, args)}>
            Send
          </button>
        </div>
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-card p-4 space-y-3">
        <h3 className="font-medium">Value sweep</h3>
        <p className="text-xs text-muted">
          Sends <code>{cmd} {channel} VV</code> for each value, one step at a time. Write down what the display shows below.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-muted">
            Channel (hex)
            <input className={`${inputClass} block w-20`} value={channel} onChange={(e) => setChannel(e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            From
            <input type="number" min={0} max={255} className={`${inputClass} block w-20`} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
          </label>
          <label className="text-xs text-muted">
            To
            <input type="number" min={0} max={255} className={`${inputClass} block w-20`} value={to} onChange={(e) => setTo(Number(e.target.value))} />
          </label>
          <button className={btn} disabled={busy || (value !== null && value <= from)} onClick={() => void step(value === null ? from : value - 1)}>
            Previous
          </button>
          <button className={btn} disabled={busy || (value !== null && value >= to)} onClick={() => void step(value === null ? from : value + 1)}>
            {value === null ? 'Start' : `Next (${value + 1})`}
          </button>
          <span className="text-sm text-muted">Current: {value === null ? '-' : `${value} (0x${hexByte(value)})`}</span>
        </div>
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Log</h3>
          <div className="flex gap-2">
            <button
              className={btn}
              disabled={log.length === 0}
              onClick={() => {
                void navigator.clipboard?.writeText(results).then(() => onNotify('Results copied'));
              }}
            >
              Copy results
            </button>
            <button className={btn} disabled={log.length === 0} onClick={() => setLog([])}>
              Clear
            </button>
          </div>
        </div>
        {log.length === 0 && <p className="text-sm text-muted">Nothing sent yet.</p>}
        {log.map((e, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-center text-sm">
            <code className="text-accent">{e.cmd} {e.args}</code>
            <span className="text-xs text-muted break-all">{e.hex}</span>
            <input
              className={`${inputClass} flex-1 min-w-48 py-1`}
              placeholder="What did the display show?"
              value={e.note}
              onChange={(ev) => setLog((l) => l.map((x, j) => (j === i ? { ...x, note: ev.target.value } : x)))}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
