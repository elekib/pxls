import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryTransport } from "@/lib/device/memory";
import type { Pixoo } from "@/lib/device/pixoo";
import type { EngineConfig } from "@/lib/engine/config";
import { Engine, FailureLog, duration, type Connector, type EngineHooks } from "@/lib/engine/engine";

// The engine's default link control runs rfcomm / btmgmt / hciconfig. Record
// those calls instead of touching the host's Bluetooth stack.
const procs = vi.hoisted(() => ({
  calls: [] as string[][],
  fail: new Set<string>(),
  onRun: null as null | ((cmd: string, args: string[]) => void),
}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    procs.calls.push([cmd, ...args]);
    procs.onRun?.(cmd, args);
    cb(procs.fail.has(cmd) ? new Error(`${cmd} failed`) : null, "", "");
  }),
}));

beforeEach(() => {
  procs.calls = [];
  procs.fail.clear();
  procs.onRun = null;
});

const config: EngineConfig = { mac: null, channel: 1, rfcommDev: 0, debug: false, adapterReset: false, adapterIndex: 0 };

function setup(
  opts: {
    mac?: string | null;
    connector?: Connector;
    hooks?: Partial<EngineHooks>;
    connectTimeoutMs?: number;
    retryMs?: number;
    releaseSettleMs?: number;
    config?: Partial<EngineConfig>;
  } = {},
) {
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
  const engine = new Engine({ ...config, ...opts.config }, connect, { getMac: () => mac, ...opts.hooks }, opts.retryMs ?? 10, opts.connectTimeoutMs, {
    releaseSettleMs: opts.releaseSettleMs ?? 20,
  });
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

  it("gives up on a connect that never answers, and closes the link if it arrives late", async () => {
    let release!: (t: MemoryTransport) => void;
    const late = new MemoryTransport();
    let calls = 0;
    const { engine } = setup({
      connectTimeoutMs: 30,
      connector: () => {
        calls++;
        return calls === 1 ? new Promise<MemoryTransport>((r) => (release = r)) : Promise.reject(new Error("host is down"));
      },
    });
    engine.start();
    // The blocked attempt is released and abandoned; retries carry on.
    await vi.waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(engine.getStatus().device).toBe("error");
    expect(procs.calls).toContainEqual(["rfcomm", "release", "0"]);
    expect(engine.linkHealth().abandoned).toBe(1);
    release(late);
    await vi.waitFor(() => expect(late.closes).toBe(1));
    expect(engine.linkHealth().abandoned).toBe(0);
    await engine.stop();
  });

  it("answers Connect with the timeout instead of hanging", async () => {
    let calls = 0;
    const { engine } = setup({
      connectTimeoutMs: 30,
      connector: async () => (++calls === 1 ? new MemoryTransport() : new Promise<MemoryTransport>(() => {})),
    });
    engine.start();
    await vi.waitFor(() => expect(engine.getStatus().device).toBe("connected"));
    const started = Date.now();
    const r = await engine.connectNow("11:22:33:44:55:66");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
    expect(Date.now() - started).toBeLessThan(1000);
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

/** A connector whose attempts never return, like open() on a wedged controller. */
function hanging() {
  let calls = 0;
  const connector: Connector = () => {
    calls++;
    return new Promise<MemoryTransport>(() => {});
  };
  return { connector, calls: () => calls };
}

const resets = () => procs.calls.filter((c) => c[0] === "btmgmt" && c.at(-1) === "off").length;

describe("Engine with a connect stuck in the kernel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Production timings: 2 s retry, 20 s timeout, 5 s wait after release.
  const timings = { retryMs: 2000, connectTimeoutMs: 20_000, releaseSettleMs: 5000 };

  it("releases rfcomm on timeout and starts a new attempt instead of hitting the in-progress guard", async () => {
    const h = hanging();
    const { engine } = setup({ ...timings, connector: h.connector });
    engine.start();
    expect(h.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(procs.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(procs.calls).toEqual([["rfcomm", "release", "0"]]);
    // open() did not return within 5 s: the attempt is abandoned, not waited on forever.
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.linkHealth()).toMatchObject({ abandoned: 1, consecutiveTimeouts: 1 });
    expect(engine.getStatus()).toMatchObject({ device: "error", error: expect.stringContaining("timed out after 20s") });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("released rfcomm0 but open() is still blocked"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.calls()).toBe(2);
    expect(engine.getStatus().error).not.toMatch(/still in progress/);
    await engine.stop();
  });

  it("lets a manual Connect start a new attempt after a timed-out one", async () => {
    const h = hanging();
    const { engine } = setup({ ...timings, connector: h.connector });
    engine.start();
    await vi.advanceTimersByTimeAsync(25_000);
    const r = engine.connectNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await r).toEqual({ ok: false, error: expect.stringContaining("timed out") });
    await engine.stop();
  });

  it("clears the in-flight attempt through the normal path when release makes open() fail", async () => {
    let calls = 0;
    let fail: ((e: Error) => void) | null = null;
    procs.onRun = (cmd, args) => {
      if (cmd === "rfcomm" && args[0] === "release") fail?.(Object.assign(new Error("Host is down"), { code: "EHOSTDOWN" }));
    };
    const { engine } = setup({
      ...timings,
      connector: () => {
        calls++;
        return new Promise<MemoryTransport>((_, reject) => (fail = reject));
      },
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(procs.calls).toEqual([["rfcomm", "release", "0"]]);
    expect(engine.linkHealth()).toMatchObject({ abandoned: 0, consecutiveTimeouts: 1 });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("released rfcomm0 and the blocked open() returned"));
    // No 5 s wait: the retry follows the normal 2 s backoff.
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    await engine.stop();
  });

  it("resets the adapter once after three timeouts in a row with PXLS_ADAPTER_RESET=1", async () => {
    const h = hanging();
    const { engine } = setup({ ...timings, connector: h.connector, config: { adapterReset: true } });
    engine.start();
    // Attempts at 0 s, 27 s and 56 s; each times out after 20 s and waits 5 s.
    await vi.advanceTimersByTimeAsync(80_999);
    expect(h.calls()).toBe(3);
    expect(resets()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(procs.calls.filter((c) => c[0] !== "rfcomm")).toEqual([
      ["btmgmt", "--index", "0", "power", "off"],
      ["btmgmt", "--index", "0", "power", "on"],
    ]);
    expect(engine.linkHealth().consecutiveTimeouts).toBe(0);
    // The counter starts over: two more failures do not reset again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.linkHealth().consecutiveTimeouts).toBe(2);
    expect(resets()).toBe(1);
    await engine.stop();
  });

  it("falls back to hciconfig when btmgmt fails, on the configured adapter", async () => {
    procs.fail.add("btmgmt");
    const h = hanging();
    const { engine } = setup({ ...timings, connector: h.connector, config: { adapterReset: true, adapterIndex: 1 } });
    engine.start();
    await vi.advanceTimersByTimeAsync(81_000);
    expect(procs.calls.filter((c) => c[0] !== "rfcomm")).toEqual([
      ["btmgmt", "--index", "1", "power", "off"],
      ["hciconfig", "hci1", "reset"],
    ]);
    await engine.stop();
  });

  it("never resets the adapter without PXLS_ADAPTER_RESET, but says what to do", async () => {
    const h = hanging();
    const { engine } = setup({ ...timings, connector: h.connector });
    engine.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(procs.calls.every((c) => c[0] === "rfcomm")).toBe(true);
    expect(engine.linkHealth().consecutiveTimeouts).toBeGreaterThanOrEqual(3);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("PXLS_ADAPTER_RESET=1"));
    await engine.stop();
  });

  it("stops starting attempts while too many are blocked, and keeps releasing and logging", async () => {
    const h = hanging();
    const { engine } = setup({ ...timings, connector: h.connector });
    engine.start();
    await vi.advanceTimersByTimeAsync(600_000);
    // At most 3 blocked open() calls at once (the worker pool has 4 threads).
    expect(h.calls()).toBe(3);
    expect(engine.linkHealth().abandoned).toBe(3);
    expect(engine.getStatus().error).toMatch(/3 timed-out connection attempts are still blocked in the kernel \(oldest for \d+m\d\ds\)/);
    expect(procs.calls.length).toBeGreaterThan(3);
    // Still logging, with how long it has been down.
    const lines = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("still blocked in the kernel")).length).toBeGreaterThan(3);
    expect(lines.at(-1)).toMatch(/device down for \d+m\d\ds/);
    await engine.stop();
  });
});

describe("Engine retry backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("doubles from 2 s to a 60 s cap and starts over after a connect", async () => {
    let ok = false;
    const at: number[] = [];
    const { engine, hangups } = setup({
      retryMs: 2000,
      connector: async (_m, onHangup) => {
        at.push(Date.now());
        if (!ok) throw new Error("host is down");
        hangups.push(onHangup);
        return new MemoryTransport();
      },
    });
    const gaps = () => at.slice(1).map((t, i) => t - at[i]!);
    engine.start();
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16_000 + 32_000 + 60_000 + 60_000);
    expect(gaps()).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    expect(engine.getStatus()).toMatchObject({ device: "error", failedAttempts: 8 });
    ok = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.getStatus()).toMatchObject({ device: "connected", failedAttempts: 0, failingSince: null });
    expect(engine.linkHealth().retryDelayMs).toBe(2000);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/connected to .* after 8 failed attempts over 4m02s/));
    // After a hangup the first retry is 2 s again.
    at.length = 0;
    const lost = Date.now();
    hangups[0]!(new Error("EOF"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(at).toEqual([lost + 2000]);
    await engine.stop();
  });

  it("logs a repeating failure at least once a minute, with how long the device has been down", async () => {
    const { engine } = setup({
      retryMs: 2000,
      connector: async () => {
        throw new Error("host is down");
      },
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const lines = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toBe("[engine] device down for 0s (1 failed attempt): host is down");
    // 14 attempts in 10 minutes (at 0, 2, 6, 14, 30, 62 s, then every 60 s), logged
    // at 0 and 62 s and then once a minute.
    expect(engine.getStatus().failedAttempts).toBe(14);
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toBe("[engine] device down for 9m02s (14 failed attempts): host is down");
    await engine.stop();
  });
});

describe("FailureLog", () => {
  it("logs a new kind of failure at once and repeats at most every interval", () => {
    const f = new FailureLog(60_000);
    expect(f.failure("a", "a", 0)).toBe("device down for 0s (1 failed attempt): a");
    expect(f.failure("a", "a", 30_000)).toBeNull();
    expect(f.failure("b", "b", 31_000)).toBe("device down for 31s (3 failed attempts): b");
    expect(f.failure("b", "b", 90_000)).toBeNull();
    expect(f.failure("b", "b", 91_000)).toBe("device down for 1m31s (5 failed attempts): b");
    f.reset();
    expect(f.state()).toEqual({ since: null, attempts: 0 });
  });

  it("formats durations", () => {
    expect([duration(4000), duration(125_000), duration(3_780_000)]).toEqual(["4s", "2m05s", "1h03m"]);
  });
});
