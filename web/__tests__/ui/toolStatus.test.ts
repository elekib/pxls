import { describe, expect, it } from 'vitest';
import { NO_TOOL, clampScore, formatTime, parseToolStatus, toolLabel } from '@/ui/toolStatus';

describe('parseToolStatus', () => {
  it('is idle when no tool is reported', () => {
    expect(parseToolStatus({ connected: true, tool_type: null, tool_remaining_secs: null })).toEqual(NO_TOOL);
    expect(parseToolStatus({})).toEqual(NO_TOOL);
    expect(parseToolStatus(null)).toEqual(NO_TOOL);
  });

  it('reports a countdown with its remaining seconds', () => {
    expect(parseToolStatus({ tool_type: 'countdown', tool_remaining_secs: 42 })).toEqual({
      active: true,
      kind: 'countdown',
      remainingSeconds: 42,
    });
  });

  it('does not fall back to countdown for the sound detector', () => {
    const s = parseToolStatus({ tool_type: 'sound_detector', tool_remaining_secs: 300 });
    expect(s.kind).toBe('sound_detector');
    expect(toolLabel(s.kind)).toBe('Sound Detector Active');
  });

  it('has no timer for the scoreboard, so it never shows 1440:00', () => {
    const s = parseToolStatus({ tool_type: 'scoreboard', tool_remaining_secs: null });
    expect(s).toEqual({ active: true, kind: 'scoreboard', remainingSeconds: null });
    expect(toolLabel(s.kind)).toBe('Scoreboard Active');
  });

  it('ignores backend states that are not user tools', () => {
    expect(parseToolStatus({ tool_type: 'diagnostics', tool_remaining_secs: 100 })).toEqual(NO_TOOL);
  });

  it('never reports negative time', () => {
    expect(parseToolStatus({ tool_type: 'countdown', tool_remaining_secs: -3 }).remainingSeconds).toBe(0);
  });
});

describe('formatTime', () => {
  it('formats minutes and padded seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(1500)).toBe('25:00');
  });
});

describe('clampScore', () => {
  it('keeps scores within 0-999', () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(1000)).toBe(999);
    expect(clampScore(12)).toBe(12);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});
