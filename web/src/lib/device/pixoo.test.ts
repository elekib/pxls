import { image } from "@/lib/protocol";
import { describe, expect, it } from "vitest";
import { Pixoo } from "./pixoo";
import { MemoryTransport } from "./memory";

describe("Pixoo", () => {
  it("frames brightness and clamps it", async () => {
    const t = new MemoryTransport();
    const p = new Pixoo(t);
    await p.setBrightness(50);
    await p.setBrightness(250);
    expect(t.packets.map((b) => Array.from(b))).toEqual([
      [0x01, 0x04, 0x00, 0x74, 0x32, 0xaa, 0x00, 0x02],
      [0x01, 0x04, 0x00, 0x74, 0x64, 0xdc, 0x00, 0x02],
    ]);
  });

  it("sends an image as one packet", async () => {
    const t = new MemoryTransport();
    await new Pixoo(t).setImage(image.solid(255, 0, 0));
    expect(t.packets).toHaveLength(1);
    expect(Array.from(t.packets[0]!.subarray(0, 4))).toEqual([0x01, 0x31, 0x00, 0x44]);
  });

  it("sends mode, tool and buzzer packets", async () => {
    const t = new MemoryTransport();
    const p = new Pixoo(t);
    await p.setMode({ kind: "user" });
    await p.setToolInfo({ kind: "timer", start: true });
    await p.playBuzzer(1000);
    expect(t.packets.map((b) => Array.from(b))).toEqual([
      [0x01, 0x05, 0x00, 0x45, 0x05, 0x00, 0x4f, 0x00, 0x02],
      [0x01, 0x05, 0x00, 0x72, 0x00, 0x01, 0x78, 0x00, 0x02],
      [0x01, 0x05, 0x00, 0x31, 0xe8, 0x03, 0x21, 0x01, 0x02],
    ]);
  });

  it("sends nothing for time format until verified", async () => {
    const t = new MemoryTransport();
    await new Pixoo(t).setTimeFormat("24h");
    expect(t.packets).toHaveLength(0);
  });

  it("fails after disconnect and closes once", async () => {
    const t = new MemoryTransport();
    const p = new Pixoo(t);
    await p.disconnect();
    await p.disconnect();
    expect(p.isConnected).toBe(false);
    expect(t.closes).toBe(1);
    await expect(p.setBrightness(10)).rejects.toThrow("not connected");
  });
});
