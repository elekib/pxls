"use client";

// Ported from the original Vite UI (frontend/src on main) as-is.

import { useEffect, useState, type ReactNode } from 'react';
import { API_URL } from '@/ui/types';

export const inputClass =
  'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500';
export const compactInputClass =
  'w-full px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm focus:outline-none focus:border-cyan-500';
export const btn = {
  primary: 'px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg font-medium transition-colors disabled:opacity-50',
  secondary: 'px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors disabled:opacity-50',
  small: 'px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors disabled:opacity-40',
  smallPrimary: 'px-3 py-1 bg-cyan-600 hover:bg-cyan-700 rounded text-sm transition-colors disabled:opacity-40',
  smallDanger: 'px-3 py-1 bg-red-600/80 hover:bg-red-600 rounded text-sm transition-colors disabled:opacity-40',
};

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-gray-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-green-600' : 'bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Badge({
  tone = 'gray', children, title,
}: { tone?: 'gray' | 'green' | 'red' | 'blue' | 'purple' | 'yellow'; children: ReactNode; title?: string }) {
  const tones = {
    gray: 'bg-gray-700 text-gray-300',
    green: 'bg-green-600/20 text-green-400',
    red: 'bg-red-600/20 text-red-400',
    blue: 'bg-blue-600/20 text-blue-400',
    purple: 'bg-purple-600/20 text-purple-300',
    yellow: 'bg-yellow-600/20 text-yellow-400',
  };
  return (
    <span title={title} className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Where external services should POST to reach a webhook (never includes the secret). */
export function webhookUrl(path: string): string {
  return `${window.location.origin}${API_URL}/api/webhook/${encodeURIComponent(path)}`;
}

/** Same URL with the secret in the query string, for senders that cannot set headers. */
export function webhookUrlWithSecret(path: string, secret: string): string {
  return `${webhookUrl(path)}?secret=${encodeURIComponent(secret)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  // Plain-http LAN deployments have no async clipboard API
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(area);
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}
      className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
    >
      {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Modal shell: closes on Escape and backdrop click. */
export function Modal({
  title, onClose, children, footer,
}: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label={title} className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[92vh] flex flex-col">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-4 sm:px-6 py-4 border-t border-gray-700 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
