import { AccountPage } from "@/components/screens/AccountPage";
import { getAccounts } from "@/lib/auth";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await requireUser();
  const sessions = (await getAccounts().listSessions(me.user.id)).map((s) => ({ ...s, current: s.id === me.sessionId }));
  return <AccountPage user={me.user} sessions={sessions} />;
}
