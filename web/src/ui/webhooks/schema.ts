import type {
  Action, ActionType, Condition, ConditionOperator, DisplayMode, Rule,
} from './types';

interface Option<T extends string = string> { value: T; label: string }

export const DISPLAY_MODES: Option<DisplayMode>[] = [
  { value: 'text', label: 'Text Only' },
  { value: 'icon_only', label: 'Icon Only' },
  { value: 'icon_with_text', label: 'Icon + Text' },
  { value: 'image', label: 'Image' },
];

export const PRESET_COLORS: Option[] = [
  { label: 'Black', value: '000000' },
  { label: 'Red', value: 'FF0000' },
  { label: 'Green', value: '00FF00' },
  { label: 'Blue', value: '0000FF' },
  { label: 'Yellow', value: 'FFFF00' },
  { label: 'Cyan', value: '00FFFF' },
  { label: 'Magenta', value: 'FF00FF' },
  { label: 'White', value: 'FFFFFF' },
  { label: 'Gold', value: 'FFD700' },
  { label: 'Orange', value: 'FFA500' },
];

export const ICON_PRESETS = [
  { emoji: '📺', label: 'TV/Request' },
  { emoji: '🎬', label: 'Movie' },
  { emoji: '📥', label: 'Download' },
  { emoji: '🧪', label: 'Test' },
  { emoji: '🔔', label: 'Notification' },
  { emoji: '⚡', label: 'New Release' },
  { emoji: '✅', label: 'Complete' },
  { emoji: '❌', label: 'Error' },
];

export const OPERATORS: Option<ConditionOperator>[] = [
  { value: 'Equals', label: 'equals' },
  { value: 'NotEquals', label: 'does not equal' },
  { value: 'Contains', label: 'contains' },
  { value: 'NotContains', label: 'does not contain' },
  { value: 'GreaterThan', label: 'is greater than' },
  { value: 'LessThan', label: 'is less than' },
  { value: 'Exists', label: 'exists' },
  { value: 'NotExists', label: 'does not exist' },
];

export const OPERATORS_WITHOUT_VALUE = new Set<ConditionOperator>(['Exists', 'NotExists']);

export const ACTION_TYPES: Option<ActionType>[] = [
  { value: 'DisplayNotification', label: 'Display Notification' },
  { value: 'DisplayImage', label: 'Display Image' },
  { value: 'FlashScreen', label: 'Flash Screen' },
  { value: 'PlaySound', label: 'Play Sound' },
  { value: 'LogEvent', label: 'Log Event' },
  { value: 'ForwardWebhook', label: 'Forward Webhook' },
];

const IMAGE_SOURCES: Option[] = [
  { value: 'url', label: 'URL' },
  { value: 'base64', label: 'Base64' },
  { value: 'template', label: 'Template' },
  { value: 'text_overlay', label: 'Text Overlay' },
];

const SOUND_TYPES: Option[] = [
  { value: 'default', label: 'Default' },
  { value: 'short', label: 'Short' },
  { value: 'beep', label: 'Beep' },
  { value: 'alarm', label: 'Alarm' },
];

const LOG_LEVELS: Option[] = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const HTTP_METHODS: Option[] = ['POST', 'GET', 'PUT', 'DELETE'].map((m) => ({ value: m, label: m }));

export interface ParamField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  placeholder?: string;
  options?: Option[];
  /** Only show when this returns true for the action's current parameters. */
  visibleWhen?: (params: Action['parameters']) => boolean;
}

const COLOR_OPTIONS = PRESET_COLORS;
const imageSource = (p: Action['parameters']) => (p.image_source as string | undefined) ?? 'url';

const FIELDS: Record<ActionType, ParamField[]> = {
  DisplayNotification: [
    { key: 'title', label: 'Title', type: 'text', placeholder: '{movie.title} or literal text' },
    { key: 'subtitle', label: 'Subtitle', type: 'text', placeholder: '{movie.overview}' },
    { key: 'icon', label: 'Icon', type: 'text', placeholder: '🎬 (defaults to webhook icon)' },
    { key: 'icon_image_url', label: 'Icon Image URL', type: 'text', placeholder: 'https://...' },
    { key: 'display_mode', label: 'Display Mode', type: 'select', options: DISPLAY_MODES },
    { key: 'background_color', label: 'Background Color', type: 'select', options: COLOR_OPTIONS },
    { key: 'text_color', label: 'Text Color', type: 'select', options: COLOR_OPTIONS },
    { key: 'duration_secs', label: 'Duration (sec)', type: 'number', placeholder: '10' },
    { key: 'delay_ms', label: 'Delay before (ms)', type: 'number', placeholder: '0' },
    { key: 'flash', label: 'Flash', type: 'checkbox' },
    {
      key: 'flash_speed_ms', label: 'Flash Speed (ms)', type: 'number', placeholder: '500',
      visibleWhen: (p) => !!p.flash,
    },
  ],
  DisplayImage: [
    { key: 'image_source', label: 'Image Source', type: 'select', options: IMAGE_SOURCES },
    {
      key: 'url', label: 'URL', type: 'text', placeholder: '{movie.images[0].remoteUrl}',
      visibleWhen: (p) => imageSource(p) === 'url',
    },
    {
      key: 'url_field', label: 'URL Field Path', type: 'text', placeholder: 'movie.images[0].remoteUrl',
      visibleWhen: (p) => imageSource(p) === 'url',
    },
    {
      key: 'base64_data', label: 'Base64 Data', type: 'text', placeholder: 'iVBORw0KG...',
      visibleWhen: (p) => imageSource(p) === 'base64',
    },
    {
      key: 'base_image_url', label: 'Base Image URL', type: 'text', placeholder: 'https://...',
      visibleWhen: (p) => imageSource(p) === 'text_overlay',
    },
    {
      key: 'overlay_text', label: 'Overlay Text', type: 'text', placeholder: '{title}',
      visibleWhen: (p) => imageSource(p) === 'text_overlay',
    },
    { key: 'width', label: 'Width', type: 'number', placeholder: '64' },
    { key: 'height', label: 'Height', type: 'number', placeholder: '64' },
    { key: 'crop_y_offset', label: 'Crop shift (rows)', type: 'number', placeholder: '0 (+ moves content up)' },
    { key: 'duration_secs', label: 'Duration (sec)', type: 'number', placeholder: '10' },
    { key: 'delay_ms', label: 'Delay before (ms)', type: 'number', placeholder: '0' },
    { key: 'flash', label: 'Flash', type: 'checkbox' },
    {
      key: 'flash_speed_ms', label: 'Flash Speed (ms)', type: 'number', placeholder: '500',
      visibleWhen: (p) => !!p.flash,
    },
  ],
  FlashScreen: [
    { key: 'color', label: 'Color', type: 'select', options: COLOR_OPTIONS },
    { key: 'duration_ms', label: 'Duration (ms)', type: 'number', placeholder: '500' },
    { key: 'flash_speed_ms', label: 'Flash Speed (ms)', type: 'number', placeholder: '200' },
  ],
  PlaySound: [
    { key: 'sound_type', label: 'Sound Type', type: 'select', options: SOUND_TYPES },
    { key: 'total_time_ms', label: 'Total Time (ms)', type: 'number', placeholder: '1000' },
    { key: 'active_time_ms', label: 'Active Time (ms)', type: 'number', placeholder: '500' },
    { key: 'off_time_ms', label: 'Off Time (ms)', type: 'number', placeholder: '0' },
  ],
  LogEvent: [
    { key: 'message', label: 'Message', type: 'text', placeholder: 'Downloaded {movie.title}' },
    { key: 'level', label: 'Level', type: 'select', options: LOG_LEVELS },
  ],
  ForwardWebhook: [
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/webhook' },
    { key: 'method', label: 'Method', type: 'select', options: HTTP_METHODS },
  ],
};

export const getActionParamFields = (type: ActionType): ParamField[] => FIELDS[type] ?? [];

export const emptyCondition = (): Condition => ({
  field_path: '', operator: 'Equals', value: '', case_insensitive: false,
});
export const emptyAction = (): Action => ({ action_type: 'DisplayNotification', parameters: {} });
export const emptyRule = (): Rule => ({
  id: '',
  name: '',
  enabled: true,
  condition_logic: 'All',
  conditions: [emptyCondition()],
  actions: [emptyAction()],
});

/** Client-side mirror of the server's validate_rule, for inline feedback. */
export function validateRule(rule: Rule): string | null {
  if (!rule.name.trim()) return 'Rule name is required';
  if (rule.conditions.length === 0) return 'At least one condition is required';
  if (rule.conditions.some((c) => !c.field_path.trim())) return 'Every condition needs a field path';
  if (rule.actions.length === 0) return 'At least one action is required';
  for (const [i, a] of rule.actions.entries()) {
    const p = a.parameters;
    if (a.action_type === 'ForwardWebhook' && !String(p.url ?? '').trim()) {
      return `Action ${i + 1}: Forward Webhook needs a URL`;
    }
    if (a.action_type === 'DisplayImage') {
      if (p.image_source === 'base64' && !String(p.base64_data ?? '').trim()) {
        return `Action ${i + 1}: base64 source needs base64 data`;
      }
      if (p.image_source === 'text_overlay' && !String(p.base_image_url ?? '').trim()) {
        return `Action ${i + 1}: text overlay needs a base image URL`;
      }
    }
  }
  return null;
}

// ---- Human-readable summaries ----------------------------------------------

const OPERATOR_LABEL = Object.fromEntries(OPERATORS.map((o) => [o.value, o.label]));

export function describeCondition(c: Condition): string {
  const op = OPERATOR_LABEL[c.operator] ?? c.operator;
  if (OPERATORS_WITHOUT_VALUE.has(c.operator)) return `${c.field_path} ${op}`;
  const value = typeof c.value === 'string' ? c.value : JSON.stringify(c.value);
  return `${c.field_path} ${op} "${value}"`;
}

export function describeAction(a: Action): string {
  const label = ACTION_TYPES.find((t) => t.value === a.action_type)?.label ?? a.action_type;
  const p = a.parameters;
  const detail =
    a.action_type === 'DisplayNotification' ? p.title
    : a.action_type === 'DisplayImage' ? (p.url ?? p.url_field ?? p.image_source)
    : a.action_type === 'LogEvent' ? p.message
    : a.action_type === 'ForwardWebhook' ? p.url
    : a.action_type === 'FlashScreen' ? p.color
    : a.action_type === 'PlaySound' ? p.sound_type
    : undefined;
  return detail ? `${label}: ${detail}` : label;
}

// ---- Service presets ---------------------------------------------------------

export interface ServicePreset {
  id: string;
  label: string;
  /** Suggested webhook name/path. */
  path: string;
  icon: string;
  titleField: string;
  subtitleField: string;
  /** Payload field that identifies the event kind. */
  eventField: string;
  samples: { label: string; payload: unknown }[];
  ruleTemplates: { label: string; rule: Omit<Rule, 'id'> }[];
}

const ci = (field: string, value: string): Condition =>
  ({ field_path: field, operator: 'Equals', value, case_insensitive: true });

/** 16x16 screen: a short event label as the title, first word of the media title below it. */
function labelRule(name: string, event: string, label: string, titlePath: string, color: string, flashMs: number): Omit<Rule, 'id'> {
  return {
    name, enabled: true, condition_logic: 'All', conditions: [ci('eventType', event)],
    actions: [{ action_type: 'DisplayNotification', parameters: {
      title: label, subtitle: `{${titlePath}}`, display_mode: 'text',
      background_color: color, text_color: '000000', flash: true, flash_speed_ms: flashMs, duration_secs: 8,
    } }],
  };
}

/** Poster from the payload's images, picked by coverType so ordering doesn't matter. */
function posterRule(name: string, event: string, mediaKey: string, color: string, flashMs: number): Omit<Rule, 'id'> {
  return {
    name, enabled: true, condition_logic: 'All', conditions: [ci('eventType', event)],
    actions: [
      // The display shows one thing at a time: label first, then the poster after a delay
      { action_type: 'DisplayNotification', parameters: {
        title: 'DONE', subtitle: `{${mediaKey}.title}`, display_mode: 'text',
        background_color: color, text_color: '000000', flash: true, flash_speed_ms: flashMs, duration_secs: 3,
      } },
      { action_type: 'DisplayImage', parameters: {
        image_source: 'url', url_field: `${mediaKey}.images[coverType=poster].remoteUrl`,
        width: 16, height: 16, crop_y_offset: 2, duration_secs: 12, delay_ms: 3000,
      } },
    ],
  };
}

export const SERVICE_PRESETS: ServicePreset[] = [
  {
    id: 'radarr', label: 'Radarr', path: 'radarr', icon: '🎬',
    titleField: 'movie.title', subtitleField: 'eventType', eventField: 'eventType',
    samples: [
      { label: 'Grab', payload: { eventType: 'Grab', movie: { title: 'Inception', year: 2010 }, release: { quality: 'Bluray-1080p' } } },
      { label: 'Download', payload: { eventType: 'Download', movie: { title: 'Dune', year: 2021, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w300/d5NXSklXo0qyIYkgV94XAgMIckC.jpg' }] }, isUpgrade: false } },
      { label: 'Movie added', payload: { eventType: 'MovieAdded', movie: { title: 'Dune: Part Two', year: 2024 } } },
      { label: 'Test', payload: { eventType: 'Test', movie: { title: 'Test Movie' } } },
    ],
    ruleTemplates: [
      { label: 'Grabbed (text)', rule: labelRule('grabbed', 'Grab', 'GRAB', 'movie.title', 'FFD700', 300) },
      { label: 'Downloaded (poster)', rule: posterRule('downloaded_poster', 'Download', 'movie', 'FFD700', 300) },
    ],
  },
  {
    id: 'sonarr', label: 'Sonarr', path: 'sonarr', icon: '📺',
    titleField: 'series.title', subtitleField: 'eventType', eventField: 'eventType',
    samples: [
      { label: 'Grab', payload: { eventType: 'Grab', series: { title: 'Severance' }, episodes: [{ seasonNumber: 2, episodeNumber: 1, title: 'Hello, Ms. Cobel' }] } },
      { label: 'Download', payload: { eventType: 'Download', series: { title: 'Severance', images: [{ coverType: 'banner', remoteUrl: 'https://image.tmdb.org/t/p/w300/lFf6LLrQjYldcZItzOkGmMMigP7.jpg' }, { coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w300/lFf6LLrQjYldcZItzOkGmMMigP7.jpg' }] }, episodes: [{ seasonNumber: 2, episodeNumber: 1, title: 'Hello, Ms. Cobel' }] } },
      { label: 'Series added', payload: { eventType: 'SeriesAdd', series: { title: 'Andor' } } },
      { label: 'Test', payload: { eventType: 'Test', series: { title: 'Test Series' } } },
    ],
    ruleTemplates: [
      { label: 'Grabbed (text)', rule: labelRule('grabbed', 'Grab', 'GRAB', 'series.title', '00FFFF', 500) },
      { label: 'Downloaded (poster)', rule: posterRule('downloaded_poster', 'Download', 'series', '00FFFF', 500) },
    ],
  },
  {
    id: 'overseerr', label: 'Overseerr / Jellyseerr', path: 'overseerr', icon: '⚡',
    titleField: 'subject', subtitleField: 'message', eventField: 'notification_type',
    samples: [
      { label: 'Request pending', payload: { notification_type: 'MEDIA_PENDING', subject: 'Dune (2021)', message: 'A new request is pending approval', media: { media_type: 'movie', status: 'PENDING' }, request: { requestedBy_username: 'alex' } } },
      { label: 'Request approved', payload: { notification_type: 'MEDIA_APPROVED', subject: 'Dune (2021)', message: 'Your request was approved', media: { media_type: 'movie', status: 'PROCESSING' } } },
      { label: 'Available', payload: { notification_type: 'MEDIA_AVAILABLE', subject: 'Dune (2021)', message: 'Now available', media: { media_type: 'movie', status: 'AVAILABLE' } } },
    ],
    ruleTemplates: [
      {
        label: 'Requested (text)',
        rule: {
          name: 'requested', enabled: true, condition_logic: 'Any',
          conditions: [ci('notification_type', 'MEDIA_PENDING'), ci('notification_type', 'MEDIA_AUTO_APPROVED')],
          actions: [{ action_type: 'DisplayNotification', parameters: {
            title: 'REQ', subtitle: '{subject}', display_mode: 'text',
            background_color: '800080', text_color: 'FFFFFF', flash: true, flash_speed_ms: 400, duration_secs: 10,
          } }],
        },
      },
      {
        label: 'Available (label + poster)',
        rule: {
          name: 'available', enabled: true, condition_logic: 'All',
          conditions: [ci('notification_type', 'MEDIA_AVAILABLE')],
          actions: [
            { action_type: 'DisplayNotification', parameters: {
              title: 'NEW', subtitle: '{subject}', display_mode: 'text',
              background_color: '00FF00', text_color: '000000', flash: true, flash_speed_ms: 400, duration_secs: 3,
            } },
            // Seerr includes the poster URL as a top-level `image` field
            { action_type: 'DisplayImage', parameters: {
              image_source: 'url', url_field: 'image', width: 16, height: 16, crop_y_offset: 2, duration_secs: 12, delay_ms: 3000,
            } },
          ],
        },
      },
    ],
  },
];

export const GENERIC_SAMPLE = { title: 'Test', subtitle: 'This is a test webhook' };

/** Best-effort match of a webhook to a service preset by its name/path. */
export function presetFor(name: string, path: string): ServicePreset | undefined {
  const key = `${name} ${path}`.toLowerCase();
  return SERVICE_PRESETS.find(
    (p) => key.includes(p.id) || (p.id === 'overseerr' && key.includes('jellyseerr')),
  );
}

export const prettyJson = (v: unknown) => JSON.stringify(v, null, 2);

/** Dot/bracket paths of every leaf in a payload, e.g. `movie.title`, `images[0].url`. */
export function flattenPaths(value: unknown, prefix = '', out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 6 || out.size > 200) return out;
  if (Array.isArray(value)) {
    // Only the first element: siblings share a shape
    if (value.length > 0) flattenPaths(value[0], `${prefix}[0]`, out, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenPaths(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  } else if (prefix) {
    out.add(prefix);
  }
  return out;
}
