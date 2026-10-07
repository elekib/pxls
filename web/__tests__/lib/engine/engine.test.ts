import { describe, expect, it, vi } from "vitest";
import { MemoryTransport } from "@/lib/device/memory";
import type { Pixoo } from "@/lib/device/pixoo";
import { Engine, type Connector, type EngineHooks } from "@/lib/engine/engine";

const config = { mac: null, channel: 1, rfcommDev: 0, debug: false };

function setup(opts: { mac?: string | null; connector?: Connector; hooks?: Partial<EngineHooks> } = {}) {
  const transports: MemoryTransport[] = [];
  const hangups: ((e?: Error) => void)[] = [];
  const macs: string[] = [];
  let mac: string | null = opts.mac === undefined ? "11:22:33:44:55:66" : opts.mac;
  const connect: Connector =
    opts.connector ??
    (async (m, onHangup) => {
      const t = new MemoryTransport();
      transports.push(t);
      hangups.push(onHangup);
      macs.push(m);
      return t;
    });
  const engine = new Engine(config, connect, { getMac: () => mac, ...opts.hooks }, 10);
  return { engine, transports, hangups, macs, setMac: (m: string | null) => (mac = m) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Engine", () => {
  it("stays disabled without a MAC", async () => {
    const { engine } = setup({ mac: null });
    engine.start();
    await settle();
    expect(engine.getStatus().device).toBe("disabled");
    await engine.stop();
  });

  it("connects, applies the device config and serializes work", async () => {
    const onConnected = vi.fn(async (p: Pixoo) => p.setBrightness(30));
    const { engine, transports } = setup({ hooks: { onConnected } });
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    await Promise.all([engine.run((p) => p.setBrightness(10)), engine.run((p) => p.setBrightness(20))]);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(transports[0]!.packets.map((p) => p[4])).toEqual([30, 10, 20]);
    await engine.stop();
  });

  it("rejects work while not connected", async () => {
    const { engine } = setup();
    await expect(engine.run((p) => p.setBrightness(10))).rejects.toThrow("device disabled");
  });

  it("retries until the connector succeeds", async () => {
    let calls = 0;
    const { engine } = setup({
      connector: async () => {
        if (++calls < 3) throw new Error("host is down");
        return new MemoryTransport();
      },
    });
    engine.start();
    await settle();
    expect(engine.getStatus()).toMatchObject({ device: "error", error: "host is down" });
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    expect(calls).toBe(3);
    await engine.stop();
  });

  it("reconnects after a hangup or a link error", async () => {
    const { engine, transports, hangups } = setup();
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    hangups[0]!(new Error("EOF"));
    await vi.waitFor(() => expect(transports).toHaveLength(2));
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    const err = Object.assign(new Error("I/O error"), { code: "EIO" });
    await expect(engine.run(async () => Promise.reject(err))).rejects.toThrow("I/O error");
    expect(transports[1]!.isOpen).toBe(false);
    await vi.waitFor(() => expect(transports).toHaveLength(3));
    await engine.stop();
  });

  it("does not reconnect after a manual disconnect until Connect", async () => {
    const { engine, transports } = setup();
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    await engine.disconnect();
    expect(engine.getStatus()).toMatchObject({ device: "disconnected", manualDisconnect: true });
    expect(transports[0]!.isOpen).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(transports).toHaveLength(1);
    expect(await engine.connectNow()).toEqual({ ok: true });
    expect(engine.getStatus()).toMatchObject({ device: "connected", manualDisconnect: false });
    await engine.stop();
  });

  it("connects to a new MAC without saving it, and reports failures", async () => {
    let fail = false;
    const macs: string[] = [];
    const { engine } = setup({
      connector: async (m) => {
        macs.push(m);
        if (fail) throw new Error("no route");
        return new MemoryTransport();
      },
    });
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    expect(await engine.connectNow("AA:BB:CC:DD:EE:FF")).toEqual({ ok: true });
    fail = true;
    expect(await engine.connectNow("AA:BB:CC:DD:EE:00")).toEqual({ ok: false, error: "no route" });
    expect(macs).toEqual(["11:22:33:44:55:66", "AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:00"]);
    // Retries go back to the saved MAC.
    await vi.waitFor(() => expect(macs.at(-1)).toBe("11:22:33:44:55:66"));
    await engine.stop();
  });

  it("drops and reconnects on forceReconnect, but not after a manual disconnect", async () => {
    const { engine, transports } = setup();
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    engine.forceReconnect();
    await vi.waitFor(() => expect(transports).toHaveLength(2));
    await engine.disconnect();
    engine.forceReconnect();
    await new Promise((r) => setTimeout(r, 30));
    expect(transports).toHaveLength(2);
    await engine.stop();
  });

  it("closes the link on stop and does not reconnect", async () => {
    const { engine, transports } = setup();
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    await engine.stop();
    expect(transports[0]!.closes).toBe(1);
    expect(engine.getStatus().device).toBe("disabled");
    await new Promise((r) => setTimeout(r, 30));
    expect(transports).toHaveLength(1);
  });
});
