// A connected display.

import {
  CMD_BRIGHTNESS,
  frame,
  image,
  mode,
  tool,
  type LightMode,
  type RgbImage,
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

  disconnect(): Promise<void> {
    return this.transport.close();
  }
}
