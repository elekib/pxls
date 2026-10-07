import { AccountPage } from "@/components/screens/AccountPage";
import { getAuth } from "@/lib/auth";
import { nowSecs } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await requireUser();
  const sessions = getAuth()
    .store.listSessions(me.user.id, nowSecs())
    .map((s) => ({ ...s, current: s.id === me.sessionId }));
  return <AccountPage user={me.user} sessions={sessions} />;
}
