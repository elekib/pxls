"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/actions/auth";
import { Alert } from "@/components/Alert";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="max-w-sm space-y-4">
      <Alert state={state} />
      <div>
        <label className="label" htmlFor="current_password">Current password</label>
        <input className="input" id="current_password" name="current_password" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <label className="label" htmlFor="new_password">New password</label>
        <input className="input" id="new_password" name="new_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm new password</label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Changing…" : "Change password"}</button>
    </form>
  );
}
