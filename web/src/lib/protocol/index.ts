export * as frame from "./frame";
export * as image from "./image";
export * as mode from "./mode";
export * as tool from "./tool";
export type { RgbImage } from "./image";
export type { LightMode, Rgb, TimeFormat } from "./mode";
export type { ToolInfo } from "./tool";

/** Command bytes that are not part of a mode or tool. */
export const CMD_BRIGHTNESS = 0x74;
export const CMD_BUZZER = 0x31;

/** Set-time-format has no verified command byte, so nothing is sent. */
export const CMD_TIME_FORMAT: number | null = null;
