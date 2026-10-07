import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryTransport } from "@/lib/device/memory";
import { Engine, type Connector } from "./engine";

const config = { mac: "11:22:33:44:55:66", channel: 1, rfcommDev: 0, debug: false };

function setup(connector?: Connector) {
  const transports: MemoryTransport[] = [];
  const hangups: ((e?: Error) => void)[] = [];
  const connect: Connector =
    connector ??
    (async (onHangup) => {
      const t = new MemoryTransport();
      transports.push(t);
      hangups.push(onHangup);
      return t;
    });
  return { engine: new Engine(config, connect, 10), transports, hangups };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("Engine", () => {
  it("stays disabled without a MAC", () => {
    const engine = new Engine({ ...config, mac: null }, async () => new MemoryTransport());
    engine.start();
    expect(engine.getStatus().device).toBe("disabled");
  });

  it("connects and serializes device work", async () => {
    const { engine, transports } = setup();
    engine.start();
    await settle();
    expect(engine.getStatus().device).toBe("connected");
    await Promise.all([engine.run((p) => p.setBrightness(10)), engine.run((p) => p.setBrightness(20))]);
    expect(transports[0]!.packets.map((p) => p[4])).toEqual([10, 20]);
  });

  it("rejects work while not connected", async () => {
    const { engine } = setup();
    await expect(engine.run((p) => p.setBrightness(10))).rejects.toThrow("device disabled");
  });

  it("retries until the connector succeeds", async () => {
    let calls = 0;
    const { engine } = setup(async () => {
      if (++calls < 3) throw new Error("host is down");
      return new MemoryTransport();
    });
    engine.start();
    await settle();
    expect(engine.getStatus()).toMatchObject({ device: "error", error: "host is down" });
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    expect(calls).toBe(3);
  });

  it("reconnects after a hangup", async () => {
    const { engine, transports, hangups } = setup();
    engine.start();
    await settle();
    hangups[0]!(new Error("EOF"));
    await settle();
    expect(transports[0]!.isOpen).toBe(false);
    await vi.waitFor(() => expect(transports).toHaveLength(2));
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
  });

  it("drops the link on a link error and reconnects", async () => {
    const { engine, transports } = setup();
    engine.start();
    await settle();
    const err = Object.assign(new Error("I/O error"), { code: "EIO" });
    await expect(engine.run(async () => Promise.reject(err))).rejects.toThrow("I/O error");
    expect(transports[0]!.isOpen).toBe(false);
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
  });

  it("closes the link on stop and does not reconnect", async () => {
    const { engine, transports } = setup();
    engine.start();
    await settle();
    await engine.stop();
    expect(transports[0]!.closes).toBe(1);
    expect(engine.getStatus().device).toBe("disabled");
    await new Promise((r) => setTimeout(r, 30));
    expect(transports).toHaveLength(1);
  });
});
