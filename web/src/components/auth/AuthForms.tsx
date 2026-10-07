"use client";

import { useActionState } from "react";
import { login, setup } from "@/app/actions/auth";
import { Alert } from "@/components/Alert";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState(login, notice ? { message: notice } : {});
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input className="input" id="username" name="username" autoComplete="username" required autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn-primary w-full py-2" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-center text-xs text-gray-500">Accounts are created by an administrator.</p>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setup, {});
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-gray-400">
        No accounts exist yet. Find the one-time setup code in the server log:
      </p>
      <pre className="overflow-x-auto rounded-lg bg-gray-900 px-3 py-2 text-xs text-gray-300">docker logs pxls 2&gt;&amp;1 | grep -i &quot;setup code&quot;</pre>
      <Alert state={state} />
      <div>
        <label className="label" htmlFor="setup_code">Setup code</label>
        <input className="input font-mono" id="setup_code" name="setup_code" autoComplete="off" required autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="username">Admin username</label>
        <input className="input" id="username" name="username" autoComplete="username" required minLength={3} maxLength={32} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        <p className="mt-1 text-xs text-gray-500">At least 12 characters.</p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm password</label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <button className="btn-primary w-full py-2" disabled={pending}>{pending ? "Creating…" : "Create the admin account"}</button>
    </form>
  );
}
