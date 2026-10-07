import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/engine/engine", () => ({
  getEngine: () => ({ getStatus: () => ({ device: "error" }) }),
  getTools: () => ({ begin: () => {} }),
}));

const { parseHex, sendRaw } = await import("@/lib/tools/diagnostics");

afterEach(() => delete process.env.PXLS_ENABLE_DEBUG);

describe("diagnostics", () => {
  it("parses hex in the accepted forms", () => {
    expect(parseHex("45 03 0A")).toEqual([0x45, 0x03, 0x0a]);
    expect(parseHex("0x45,0x03")).toEqual([0x45, 0x03]);
    expect(parseHex("45030a")).toEqual([0x45, 0x03, 0x0a]);
    expect(parseHex("")).toEqual([]);
    expect(() => parseHex("4")).toThrow(/even/);
    expect(() => parseHex("zz")).toThrow(/invalid/);
  });

  it("is off unless enabled, and validates before touching the device", async () => {
    expect((await sendRaw({ cmd: "45" })).status).toBe(403);
    process.env.PXLS_ENABLE_DEBUG = "1";
    expect(await sendRaw({ cmd: "4545" })).toEqual({ status: 400, body: { error: "cmd must be exactly one byte" } });
    expect((await sendRaw({ cmd: "45", args: "0".repeat(514) })).body.error).toMatch(/max 256/);
    expect((await sendRaw({ cmd: "45", args: "03" })).status).toBe(409); // no device connected
  });
});
