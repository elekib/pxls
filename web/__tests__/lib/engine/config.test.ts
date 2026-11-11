import { describe, expect, it } from "vitest";
import { readConfig as read } from "@/lib/engine/config";

const readConfig = (env: Record<string, string>) => read(env as NodeJS.ProcessEnv);

describe("readConfig", () => {
  it("keeps the adapter reset off by default", () => {
    expect(readConfig({})).toMatchObject({ adapterReset: false, adapterIndex: 0, rfcommDev: 0, channel: 1 });
  });

  it("reads PXLS_ADAPTER_RESET and PXLS_ADAPTER_INDEX", () => {
    expect(readConfig({ PXLS_ADAPTER_RESET: "1", PXLS_ADAPTER_INDEX: "1" })).toMatchObject({ adapterReset: true, adapterIndex: 1 });
    expect(readConfig({ PXLS_ADAPTER_RESET: "true" }).adapterReset).toBe(true);
    expect(readConfig({ PXLS_ADAPTER_RESET: "0" }).adapterReset).toBe(false);
  });

  it("ignores an invalid adapter index", () => {
    for (const v of ["-1", "256", "hci0", "1.5"]) expect(readConfig({ PXLS_ADAPTER_INDEX: v }).adapterIndex).toBe(0);
  });
});
