// Device test commands for the debug API. Validated before they reach the
// device; replaced by the real config and pages API as the port goes on.

import { z } from "zod";
import type { Pixoo } from "@/lib/device/pixoo";
import { image, mode } from "@/lib/protocol";

const byte = z.number().int().min(0).max(255);
const rgb = z.tuple([byte, byte, byte]);

export const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("brightness"), value: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal("color"), rgb }),
  z.object({ action: z.literal("clock"), design: z.number().int().min(0).max(5), rgb }),
  z.object({ action: z.literal("music"), mode: z.number().int().min(0).max(11) }),
  z.object({ action: z.literal("score"), red: z.number().int().min(0).max(999), blue: z.number().int().min(0).max(999) }),
]);
export type Command = z.infer<typeof command>;

export function apply(p: Pixoo, c: Command): Promise<void> {
  switch (c.action) {
    case "brightness":
      return p.setBrightness(c.value);
    case "color":
      return p.setImage(image.solid(...c.rgb));
    case "clock":
      return p.setMode({
        kind: "env", timeFormat: "24h", clockDesign: c.design as mode.ClockDesign, showDivoom: false,
        showWeather: false, showTemp: false, showDate: false, color: c.rgb,
      });
    case "music":
      return p.setMode({ kind: "music", mode: c.mode as mode.MusicMode });
    case "score":
      return p.setMode({ kind: "score", red: c.red, blue: c.blue });
  }
}
