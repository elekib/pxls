import { DevicePage } from "@/components/screens/DevicePage";
import { requireUser } from "@/lib/auth/session";
import { getConfig } from "@/lib/device/service";
import { getEngine } from "@/lib/engine/engine";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  const cfg = getConfig();
  const status = getEngine().getStatus();
  return (
    <DevicePage
      config={{ pixoo_mac: cfg.pixoo_mac, timezone: cfg.timezone, device_config: cfg.device_config }}
      connected={status.device === "connected"}
      manualDisconnect={status.manualDisconnect}
    />
  );
}
