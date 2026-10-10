// Ported from the original Vite UI (frontend/src on main) as-is.

import { apiFetch } from '@/ui/api';
import { API_URL } from '@/ui/types';
import type {
  Webhook, Rule, WebhookEvent, WebhookSummary, RuleTestResult, DeliveryResult,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T = Record<string, unknown>>(
  path: string,
  method: string = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || data.message || response.statusText, response.status);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const webhookApi = {
  async list(): Promise<Webhook[]> {
    const data = await request<{ webhooks?: Webhook[] }>('/api/enhanced-webhooks');
    return data.webhooks ?? [];
  },
  create: (webhook: Partial<Webhook>) => request('/api/enhanced-webhooks', 'POST', webhook),
  update: (name: string, patch: Partial<Webhook>) =>
    request(`/api/enhanced-webhooks/${enc(name)}`, 'PUT', patch),
  remove: (name: string) => request(`/api/enhanced-webhooks/${enc(name)}`, 'DELETE'),

  createRule: (webhook: string, rule: Rule) =>
    request(`/api/webhooks/${enc(webhook)}/rules`, 'POST', rule),
  updateRule: (webhook: string, key: string, rule: Rule) =>
    request(`/api/webhooks/${enc(webhook)}/rules/${enc(key)}`, 'PUT', rule),
  deleteRule: (webhook: string, key: string) =>
    request(`/api/webhooks/${enc(webhook)}/rules/${enc(key)}`, 'DELETE'),
  reorderRules: (webhook: string, order: string[]) =>
    request(`/api/webhooks/${enc(webhook)}/rules-order`, 'PUT', { order }),
  testRules: (webhook: string, payload: unknown, rule?: Rule) =>
    request<RuleTestResult>(`/api/webhooks/${enc(webhook)}/rules/test`, 'POST', { payload, rule }),

  /** Send a real delivery (runs the actions on the device). */
  async deliver(path: string, payload: unknown, secret?: string): Promise<DeliveryResult> {
    const response = await apiFetch(`${API_URL}/api/webhook/${enc(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Webhook-Secret': secret } : {}) },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  },
};

export const eventApi = {
  async list(webhookName: string, limit: number): Promise<WebhookEvent[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (webhookName) params.set('webhook_name', webhookName);
    const data = await request<{ events?: WebhookEvent[] }>(`/api/webhook-events?${params}`);
    return data.events ?? [];
  },
  async summary(): Promise<Record<string, WebhookSummary>> {
    const data = await request<{ summary?: Record<string, WebhookSummary> }>(
      '/api/webhook-events/summary',
    );
    return data.summary ?? {};
  },
  clear: (webhookName?: string) =>
    request(
      webhookName
        ? `/api/webhook-events/clear/${enc(webhookName)}`
        : '/api/webhook-events/clear-all',
      'POST',
    ),
  replay: (eventId: string) =>
    request<DeliveryResult['data']>(`/api/webhook-events/${enc(eventId)}/replay`, 'POST'),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
