import { PagesView } from "@/components/screens/PagesView";
import { requireUser } from "@/lib/auth/session";
import { getConfig, publicConfig } from "@/lib/device/service";
import type { Config } from "@/ui/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  // The browser-safe config (secrets removed), like GET /api/config.
  return <PagesView config={publicConfig(getConfig()) as unknown as Config} />;
}
