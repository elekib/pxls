import { describe, expect, it, vi } from "vitest";
import { releaseRfcomm, resetAdapter, type Exec } from "@/lib/device/bluez";

function runner(failing: (cmd: string, args: string[]) => boolean = () => false) {
  const calls: string[][] = [];
  const run: Exec = vi.fn(async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (failing(cmd, args)) throw new Error(`${cmd} failed`);
    return { stdout: "", stderr: "" };
  });
  return { run, calls };
}

describe("bluez", () => {
  it("releases the rfcomm device", async () => {
    const { run, calls } = runner();
    await releaseRfcomm(2, run);
    expect(calls).toEqual([["rfcomm", "release", "2"]]);
  });

  it("power-cycles the adapter with btmgmt", async () => {
    const { run, calls } = runner();
    expect(await resetAdapter(0, run)).toBe("btmgmt --index 0 power off/on");
    expect(calls).toEqual([
      ["btmgmt", "--index", "0", "power", "off"],
      ["btmgmt", "--index", "0", "power", "on"],
    ]);
  });

  it("falls back to an HCI reset when btmgmt is unavailable", async () => {
    const { run, calls } = runner((cmd) => cmd === "btmgmt");
    expect(await resetAdapter(1, run)).toBe("hciconfig hci1 reset");
    expect(calls.at(-1)).toEqual(["hciconfig", "hci1", "reset"]);
  });

  it("brings the adapter back up if btmgmt cannot power it on", async () => {
    const { run, calls } = runner((cmd, args) => cmd === "btmgmt" && args.at(-1) === "on");
    expect(await resetAdapter(0, run)).toBe("btmgmt --index 0 power off, hciconfig hci0 up");
    expect(calls.at(-1)).toEqual(["hciconfig", "hci0", "up"]);
  });

  it("fails when every method fails", async () => {
    const { run } = runner(() => true);
    await expect(resetAdapter(0, run)).rejects.toThrow("hciconfig failed");
  });
});
