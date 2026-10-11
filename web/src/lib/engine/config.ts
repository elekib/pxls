// Engine settings from the environment.

export interface EngineConfig {
  mac: string | null;
  channel: number;
  rfcommDev: number;
  debug: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) ? n : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  return {
    mac: env.PIXOO_MAC?.trim() || null,
    channel: int(env.PIXOO_CHANNEL, 1),
    rfcommDev: int(env.PIXOO_RFCOMM_DEV, 0),
    debug: env.PXLS_ENABLE_DEBUG === "1" || env.PXLS_ENABLE_DEBUG === "true",
  };
}
