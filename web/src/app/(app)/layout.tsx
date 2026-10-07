import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth/session";
import { getConfig } from "@/lib/device/service";
import { getEngine } from "@/lib/engine/engine";
import { revision, version } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const status = getEngine().getStatus();
  const sha = revision();
  return (
    <AppShell
      mac={getConfig().pixoo_mac}
      connected={status.device === "connected"}
      username={user.username}
      role={user.role}
      version={sha === "unknown" ? version() : `${version()} (${sha.slice(0, 7)})`}
    >
      {children}
    </AppShell>
  );
}
