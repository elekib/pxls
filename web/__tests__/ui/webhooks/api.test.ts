// Ported from the original Vite UI (frontend/src on main) as-is.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/ui/api';
import { ApiError, errorMessage, eventApi, webhookApi } from '@/ui/webhooks/api';

const mockFetch = vi.mocked(apiFetch);

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => mockFetch.mockReset());

describe('webhookApi', () => {
  it('lists webhooks, defaulting to an empty array', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, {}));
    expect(await webhookApi.list()).toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/enhanced-webhooks');
  });

  it('url-encodes webhook names and sends JSON bodies', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, {}));
    await webhookApi.update('my hook/1', { enabled: false });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/enhanced-webhooks/my%20hook%2F1');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it('throws ApiError carrying the server message and status', async () => {
    mockFetch.mockResolvedValueOnce(reply(409, { error: 'name taken' }));
    const err = await webhookApi.create({ name: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('name taken');
    expect(err.status).toBe(409);
  });

  it('adds the secret header to deliveries only when given', async () => {
    mockFetch.mockResolvedValue(reply(200, { ok: true }));
    await webhookApi.deliver('radarr', { a: 1 }, 's3cret');
    await webhookApi.deliver('radarr', { a: 1 });
    const withSecret = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    const without = mockFetch.mock.calls[1][1]?.headers as Record<string, string>;
    expect(withSecret['X-Webhook-Secret']).toBe('s3cret');
    expect(without['X-Webhook-Secret']).toBeUndefined();
  });

  it('returns the status with the delivery response', async () => {
    mockFetch.mockResolvedValueOnce(reply(401, { error: 'bad secret' }));
    expect(await webhookApi.deliver('radarr', {})).toEqual({ status: 401, data: { error: 'bad secret' } });
  });
});

describe('eventApi', () => {
  it('filters events by webhook name only when set', async () => {
    mockFetch.mockResolvedValue(reply(200, { events: [] }));
    await eventApi.list('', 50);
    await eventApi.list('radarr', 25);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/webhook-events?limit=50');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/webhook-events?limit=25&webhook_name=radarr');
  });

  it('clears one webhook or all events', async () => {
    mockFetch.mockResolvedValue(reply(200, {}));
    await eventApi.clear('radarr');
    await eventApi.clear();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/webhook-events/clear/radarr');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/webhook-events/clear-all');
  });
});

describe('errorMessage', () => {
  it('reads Error messages and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
  });
});
