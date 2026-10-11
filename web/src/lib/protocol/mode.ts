// Display modes (`0x45`). Sources and verification status are
// in docs/protocol.md.

export const CMD_MODE = 0x45;

const CH_CLOCK = 0x00;
const CH_LIGHT = 0x01;
const CH_EFFECTS = 0x03;
const CH_MUSIC = 0x04;
const CH_USER = 0x05;
const CH_SCORE = 0x06;

/** The scoreboard shows 0-999. */
export const MAX_SCORE = 999;

export type Rgb = readonly [number, number, number];
export type TimeFormat = "12h" | "24h";

export const ClockDesign = {
  Digital: 0,
  DigitalRainbow: 1,
  DigitalBox: 2,
  Analog1: 3,
  DigitalInverted: 4,
  Analog2: 5,
} as const;
export type ClockDesign = (typeof ClockDesign)[keyof typeof ClockDesign];

export const LightEffect = { Normal: 0, Rainbow: 1, Plants: 2, Fly: 3, Sleep: 4 } as const;
export type LightEffect = (typeof LightEffect)[keyof typeof LightEffect];

/** Indexes observed on a real Pixoo, not from a document. */
export const MusicMode = {
  BottomBars: 0,
  Face3: 1,
  CenterBars: 2,
  Face1: 3,
  Matrix: 4,
  FrogFace: 5,
  SideBars: 6,
  Face2: 7,
  FallingBlocks: 8,
  DancingBoy: 9,
  Fireworks: 10,
  DancingGirl: 11,
} as const;
export type MusicMode = (typeof MusicMode)[keyof typeof MusicMode];

export type LightMode =
  | {
      kind: "env";
      /** Not encoded: the documented clock layout has no 12/24h field. */
      timeFormat: TimeFormat;
      clockDesign: ClockDesign;
      /** Not encoded: no documented byte for the Divoom logo. */
      showDivoom: boolean;
      showWeather: boolean;
      showTemp: boolean;
      showDate: boolean;
      color: Rgb;
    }
  | { kind: "light"; color: Rgb; brightness: number; effect: LightEffect; on: boolean }
  | { kind: "user" }
  | { kind: "special"; mode: number }
  | { kind: "music"; mode: MusicMode }
  | { kind: "score"; red: number; blue: number };

export const clampPercent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const u8 = (n: number) => n & 0xff;
const b = (v: boolean) => (v ? 1 : 0);

/** Little-endian 16-bit score clamped to 0-999. */
export function score(n: number): [number, number] {
  const v = Math.max(0, Math.min(MAX_SCORE, Math.trunc(n)));
  return [v & 0xff, v >> 8];
}

/** Arguments for {@link CMD_MODE}. */
export function encode(mode: LightMode): number[] {
  switch (mode.kind) {
    // 45 00 01 TT time weather temp date RR GG BB; byte 3 is "fixed" in the
    // public write-up. Whether it is really a 24h flag needs device test.
    case "env":
      return [
        CH_CLOCK, 0x01, mode.clockDesign, 0x01,
        b(mode.showWeather), b(mode.showTemp), b(mode.showDate),
        ...mode.color.map(u8),
      ];
    // 45 01 RR GG BB brightness effect power 00 00 00
    case "light":
      return [CH_LIGHT, ...mode.color.map(u8), clampPercent(mode.brightness), mode.effect, b(mode.on), 0, 0, 0];
    case "user":
      return [CH_USER, 0x00];
    case "special":
      return [CH_EFFECTS, u8(mode.mode)];
    case "music":
      return [CH_MUSIC, mode.mode];
    // 45 06 00 RED(le16) BLUE(le16)
    case "score":
      return [CH_SCORE, 0x00, ...score(mode.red), ...score(mode.blue)];
  }
}
