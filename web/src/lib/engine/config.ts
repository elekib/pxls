// Engine settings from the environment.

export interface EngineConfig {
  mac: string | null;
  channel: number;
  rfcommDev: number;
  debug: boolean;
  /**
   * Power-cycle the Bluetooth adapter after repeated connect timeouts
   * (PXLS_ADAPTER_RESET=1). Off by default: it drops every Bluetooth device
   * on the host, not only the display.
   */
  adapterReset: boolean;
  /** N in hciN, the adapter to reset (PXLS_ADAPTER_INDEX). */
  adapterIndex: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) ? n : fallback;
}

const flag = (value: string | undefined) => value === "1" || value === "true";

export function readConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const adapterIndex = int(env.PXLS_ADAPTER_INDEX, 0);
  return {
    mac: env.PIXOO_MAC?.trim() || null,
    channel: int(env.PIXOO_CHANNEL, 1),
    rfcommDev: int(env.PIXOO_RFCOMM_DEV, 0),
    debug: flag(env.PXLS_ENABLE_DEBUG),
    adapterReset: flag(env.PXLS_ADAPTER_RESET),
    adapterIndex: adapterIndex >= 0 && adapterIndex <= 255 ? adapterIndex : 0,
  };
}
