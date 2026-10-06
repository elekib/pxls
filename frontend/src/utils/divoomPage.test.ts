import { describe, expect, it } from 'vitest';
import {
  buildDivoomPayload,
  defaultDivoomData,
  hexToRgb,
  isDivoomType,
  loadDivoomData,
  parseDuration,
  rgbToHex,
} from './divoomPage';

describe('divoom colour helpers', () => {
  it('round-trips hex and rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(rgbToHex([255, 128, 0])).toBe('#ff8000');
    expect(rgbToHex([0, 5, 10])).toBe('#00050a');
  });

  it('treats malformed hex as black rather than NaN', () => {
    expect(hexToRgb('#zz')).toEqual([0, 0, 0]);
  });
});

describe('divoom payloads', () => {
  it('recognises only divoom types', () => {
    expect(isDivoomType('DivoomLight')).toBe(true);
    expect(isDivoomType('CustomText')).toBe(false);
  });

  it('sends every field the backend requires, with no extras', () => {
    const payload = buildDivoomPayload('DivoomLight', { brightness: 40, junk: 1 });
    expect(payload).toEqual({
      type: 'DivoomLight',
      color: [255, 255, 255],
      brightness: 40,
      effect_mode: 0,
      on: true,
    });
  });

  it('fills missing fields when loading a partial saved page', () => {
    const data = loadDivoomData('DivoomScore', { red_score: 7 });
    expect(data).toEqual({ red_score: 7, blue_score: 0 });
  });

  it('does not share default objects between calls', () => {
    const a = defaultDivoomData('DivoomEnvironment');
    (a.color as number[])[0] = 0;
    expect(defaultDivoomData('DivoomEnvironment').color).toEqual([255, 255, 255]);
  });
});

describe('parseDuration', () => {
  it('treats blank, zero and junk as unset', () => {
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('0')).toBeUndefined();
    expect(parseDuration('abc')).toBeUndefined();
  });

  it('parses positive seconds', () => {
    expect(parseDuration('60')).toBe(60);
  });
});
