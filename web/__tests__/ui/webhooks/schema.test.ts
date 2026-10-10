// Ported from the original Vite UI (frontend/src on main) as-is.

import { describe, expect, it } from 'vitest';
import {
  describeAction, describeCondition, emptyAction, emptyRule, flattenPaths,
  getActionParamFields, presetFor, validateRule, SERVICE_PRESETS,
} from '@/ui/webhooks/schema';
import type { Rule } from '@/ui/webhooks/types';

const validRule = (): Rule => ({
  ...emptyRule(),
  name: 'grabbed',
  conditions: [{ field_path: 'eventType', operator: 'Equals', value: 'Grab', case_insensitive: true }],
});

describe('validateRule', () => {
  it('accepts a complete rule', () => {
    expect(validateRule(validRule())).toBeNull();
  });

  it('requires a name', () => {
    expect(validateRule({ ...validRule(), name: '  ' })).toBe('Rule name is required');
  });

  it('requires at least one condition with a field path', () => {
    expect(validateRule({ ...validRule(), conditions: [] })).toBe('At least one condition is required');
    const blank = { ...validRule().conditions[0], field_path: ' ' };
    expect(validateRule({ ...validRule(), conditions: [blank] })).toBe('Every condition needs a field path');
  });

  it('requires at least one action', () => {
    expect(validateRule({ ...validRule(), actions: [] })).toBe('At least one action is required');
  });

  it('requires a URL for Forward Webhook, numbering the action', () => {
    const rule = {
      ...validRule(),
      actions: [emptyAction(), { action_type: 'ForwardWebhook' as const, parameters: {} }],
    };
    expect(validateRule(rule)).toBe('Action 2: Forward Webhook needs a URL');
  });

  it('checks the data required by each image source', () => {
    const base64 = { action_type: 'DisplayImage' as const, parameters: { image_source: 'base64' } };
    expect(validateRule({ ...validRule(), actions: [base64] })).toBe(
      'Action 1: base64 source needs base64 data',
    );
    const overlay = { action_type: 'DisplayImage' as const, parameters: { image_source: 'text_overlay' } };
    expect(validateRule({ ...validRule(), actions: [overlay] })).toBe(
      'Action 1: text overlay needs a base image URL',
    );
  });
});

describe('describeCondition', () => {
  it('quotes the value for operators that take one', () => {
    const c = { field_path: 'movie.title', operator: 'Contains' as const, value: 'Dune', case_insensitive: false };
    expect(describeCondition(c)).toBe('movie.title contains "Dune"');
  });

  it('omits the value for Exists and NotExists', () => {
    const c = { field_path: 'movie', operator: 'NotExists' as const, value: '', case_insensitive: false };
    expect(describeCondition(c)).toBe('movie does not exist');
  });

  it('serialises non-string values', () => {
    const c = { field_path: 'size', operator: 'GreaterThan' as const, value: 5, case_insensitive: false };
    expect(describeCondition(c)).toBe('size is greater than "5"');
  });
});

describe('describeAction', () => {
  it('includes the most relevant parameter', () => {
    expect(
      describeAction({ action_type: 'DisplayNotification', parameters: { title: 'GRAB' } }),
    ).toBe('Display Notification: GRAB');
    expect(
      describeAction({ action_type: 'ForwardWebhook', parameters: { url: 'https://x.test' } }),
    ).toBe('Forward Webhook: https://x.test');
  });

  it('falls back to the label alone', () => {
    expect(describeAction({ action_type: 'FlashScreen', parameters: {} })).toBe('Flash Screen');
  });
});

describe('getActionParamFields', () => {
  it('shows flash speed only when flash is on', () => {
    const field = getActionParamFields('DisplayNotification').find((f) => f.key === 'flash_speed_ms');
    expect(field?.visibleWhen?.({ flash: true })).toBe(true);
    expect(field?.visibleWhen?.({ flash: false })).toBe(false);
  });

  it('shows image fields for the selected source, defaulting to url', () => {
    const fields = getActionParamFields('DisplayImage');
    const base64 = fields.find((f) => f.key === 'base64_data');
    const url = fields.find((f) => f.key === 'url');
    expect(url?.visibleWhen?.({})).toBe(true);
    expect(base64?.visibleWhen?.({})).toBe(false);
    expect(base64?.visibleWhen?.({ image_source: 'base64' })).toBe(true);
  });
});

describe('presetFor', () => {
  it('matches by name or path, case-insensitively', () => {
    expect(presetFor('My Radarr', 'hook1')?.id).toBe('radarr');
    expect(presetFor('x', 'SONARR')?.id).toBe('sonarr');
  });

  it('maps Jellyseerr onto the Overseerr preset', () => {
    expect(presetFor('jellyseerr', '')?.id).toBe('overseerr');
  });

  it('returns undefined for unknown services', () => {
    expect(presetFor('plex', 'plex')).toBeUndefined();
  });
});

describe('service presets', () => {
  it('ship rule templates that pass validation', () => {
    for (const preset of SERVICE_PRESETS) {
      for (const t of preset.ruleTemplates) {
        expect(validateRule({ ...t.rule, id: '' }), `${preset.id}: ${t.label}`).toBeNull();
      }
    }
  });
});

describe('flattenPaths', () => {
  it('lists leaf paths with dots and first-element array indexes', () => {
    const paths = flattenPaths({
      eventType: 'Download',
      movie: { title: 'Dune', images: [{ remoteUrl: 'a' }, { remoteUrl: 'b' }] },
    });
    expect([...paths].sort()).toEqual(['eventType', 'movie.images[0].remoteUrl', 'movie.title']);
  });

  it('returns nothing for empty or primitive roots', () => {
    expect(flattenPaths({}).size).toBe(0);
    expect(flattenPaths('text').size).toBe(0);
  });

  it('stops descending past the depth limit', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 10; i++) deep = { a: deep };
    expect(flattenPaths(deep).size).toBe(0);
  });
});
