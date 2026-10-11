// A connected display.

import {
  CMD_BRIGHTNESS,
  CMD_BUZZER,
  CMD_TIME_FORMAT,
  frame,
  image,
  mode,
  tool,
  type LightMode,
  type RgbImage,
  type TimeFormat,
  type ToolInfo,
} from "@/lib/protocol";
import type { Transport } from "./types";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export class Pixoo {
  constructor(
    private readonly transport: Transport,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  get isConnected(): boolean {
    return this.transport.isOpen;
  }

  async send(cmd: number, args: ArrayLike<number> = []): Promise<void> {
    const packet = frame.encode(cmd, args);
    this.log(`tx ${hex(packet)}`);
    await this.transport.send(packet);
  }

  /** 0-100 percent. */
  setBrightness(percent: number): Promise<void> {
    return this.send(CMD_BRIGHTNESS, [mode.clampPercent(percent)]);
  }

  /** Full-screen 16x16 image. Needs device test. */
  setImage(img: RgbImage): Promise<void> {
    return this.send(image.CMD_IMAGE, image.encode(img));
  }

  setMode(m: LightMode): Promise<void> {
    return this.send(mode.CMD_MODE, mode.encode(m));
  }

  setToolInfo(t: ToolInfo): Promise<void> {
    return this.send(...tool.encode(t));
  }

  /** Buzzer for `totalMs`, sent little-endian. Needs device test. */
  playBuzzer(totalMs: number): Promise<void> {
    const ms = Math.max(0, Math.min(0xffff, Math.trunc(totalMs)));
    return this.send(CMD_BUZZER, [ms & 0xff, ms >> 8]);
  }

  /** No-op until CMD_TIME_FORMAT is verified on a device. */
  async setTimeFormat(format: TimeFormat): Promise<void> {
    if (CMD_TIME_FORMAT === null) {
      this.log(`time format ${format} not sent: command unverified`);
      return;
    }
    await this.send(CMD_TIME_FORMAT, [format === "24h" ? 1 : 0]);
  }

  disconnect(): Promise<void> {
    return this.transport.close();
  }
}
