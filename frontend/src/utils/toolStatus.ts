// Maps GET /api/connection-status to what the Tools page shows.

export type ToolKind = 'countdown' | 'sound_detector' | 'scoreboard';

export interface ConnectionStatusResponse {
  connected?: boolean;
  tool_type?: string | null;
  tool_remaining_secs?: number | null;
}

export interface ToolStatus {
  active: boolean;
  kind: ToolKind | null;
  /** Seconds left; null for tools without a timer (the scoreboard). */
  remainingSeconds: number | null;
}

export const NO_TOOL: ToolStatus = { active: false, kind: null, remainingSeconds: null };

const KNOWN_KINDS: ToolKind[] = ['countdown', 'sound_detector', 'scoreboard'];

/** Backend states other than the three user tools (e.g. diagnostics) count as no tool. */
export function parseToolStatus(status: ConnectionStatusResponse | null | undefined): ToolStatus {
  const kind = KNOWN_KINDS.find((k) => k === status?.tool_type) ?? null;
  if (!kind) return NO_TOOL;
  const secs = status?.tool_remaining_secs;
  return {
    active: true,
    kind,
    remainingSeconds: typeof secs === 'number' ? Math.max(0, secs) : null,
  };
}

export function toolLabel(kind: ToolKind | null): string {
  switch (kind) {
    case 'countdown':
      return 'Countdown Active';
    case 'sound_detector':
      return 'Sound Detector Active';
    case 'scoreboard':
      return 'Scoreboard Active';
    default:
      return 'Tool Active';
  }
}

export function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const MAX_SCORE = 999;

export function clampScore(value: number): number {
  return Math.max(0, Math.min(MAX_SCORE, Math.trunc(Number(value) || 0)));
}
