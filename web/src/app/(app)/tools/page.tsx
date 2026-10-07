import { ToolsView } from "@/components/screens/ToolsView";
import { requireUser } from "@/lib/auth/session";
import { getConfig, publicConfig } from "@/lib/device/service";
import type { Config } from "@/ui/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  return <ToolsView config={publicConfig(getConfig()) as unknown as Config} />;
}
