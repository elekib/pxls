import { DiagnosticsView } from "@/components/screens/DiagnosticsView";
import { requireUser } from "@/lib/auth/session";
import { diagnosticsEnabled } from "@/lib/tools/diagnostics";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser("admin");
  return <DiagnosticsView enabled={diagnosticsEnabled()} />;
}
