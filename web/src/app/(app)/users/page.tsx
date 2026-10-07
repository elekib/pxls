import { UsersPage } from "@/components/screens/UsersPage";
import { getAuth } from "@/lib/auth";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await requireUser("admin");
  return <UsersPage me={me.user} users={getAuth().store.listUsers()} />;
}
