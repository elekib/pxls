// Tool commands: stopwatch, noise meter, countdown and the scoreboard tool.
// Port of backend/src/device/tool.rs. All need device test.

import { score } from "./mode";

export const CMD_TOOL = 0x72;
export const CMD_SCORE_TOOL = 0x50;

const TOOL_TIMER = 0x00;
const TOOL_NOISE = 0x02;
const TOOL_COUNTDOWN = 0x03;

export type ToolInfo =
  | { kind: "timer"; start: boolean }
  | { kind: "noise"; start: boolean }
  /** `seconds` is 0-59. */
  | { kind: "countdown"; start: boolean; minutes: number; seconds: number }
  | { kind: "score"; on: boolean; red: number; blue: number };

/** Command byte and arguments. */
export function encode(tool: ToolInfo): [number, number[]] {
  switch (tool.kind) {
    case "timer":
      return [CMD_TOOL, [TOOL_TIMER, tool.start ? 1 : 0]];
    case "noise":
      return [CMD_TOOL, [TOOL_NOISE, tool.start ? 1 : 0]];
    case "countdown":
      if (!Number.isInteger(tool.seconds) || tool.seconds < 0 || tool.seconds > 59) {
        throw new RangeError(`seconds must be 0-59, got ${tool.seconds}`);
      }
      return [CMD_TOOL, [TOOL_COUNTDOWN, tool.start ? 1 : 0, tool.minutes & 0xff, tool.seconds]];
    case "score":
      return [CMD_SCORE_TOOL, [tool.on ? 1 : 0, ...score(tool.red), ...score(tool.blue)]];
  }
}
