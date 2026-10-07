import { logoutEverywhere, revokeSession } from "@/app/actions/auth";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { getAuth } from "@/lib/auth";
import { nowSecs } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/session";
import { device, when } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const me = await requireUser();
  const sessions = getAuth().store.listSessions(me.user.id, nowSecs());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-gray-400">
          Signed in as <strong className="text-gray-200">{me.user.username}</strong> ({me.user.role})
        </p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Change password</h2>
        <p className="text-sm text-gray-400">Changing your password signs you out on every device.</p>
        <ChangePasswordForm />
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Active sessions</h2>
          <form action={logoutEverywhere}>
            <button className="btn-danger">Sign out everywhere</button>
          </form>
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-400">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-gray-700">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="text-sm">
                  <div className="font-medium">
                    {device(s.user_agent)}
                    {s.id === me.sessionId && <span className="ml-2 rounded bg-cyan-900 px-1.5 py-0.5 text-xs text-cyan-200">This device</span>}
                  </div>
                  <div className="text-gray-400">
                    {s.ip ?? "unknown IP"} · last used {when(s.last_used_at)} · signed in {when(s.created_at)}
                  </div>
                </div>
                <form action={revokeSession.bind(null, s.id)}>
                  <button className="btn">{s.id === me.sessionId ? "Sign out" : "Revoke"}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
