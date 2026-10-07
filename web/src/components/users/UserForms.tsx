"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/app/actions/auth";
import { createUser, deleteUser, resetPassword, revokeUserSessions, updateUser } from "@/app/actions/users";
import { Alert } from "@/components/Alert";
import type { User } from "@/lib/auth/store";

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUser, {});
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="new-username">Username</label>
          <input className="input" id="new-username" name="username" autoComplete="off" required minLength={3} maxLength={32} />
        </div>
        <div>
          <label className="label" htmlFor="new-password">Password</label>
          <input className="input" id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        </div>
        <div>
          <label className="label" htmlFor="new-role">Role</label>
          <select className="input" id="new-role" name="role" defaultValue="viewer">
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Adding…" : "Add user"}</button>
    </form>
  );
}

export function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");

  const run = (fn: () => Promise<FormState>) => start(async () => setState(await fn()));

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">
            {user.username}
            {isSelf && <span className="ml-2 text-xs text-gray-500">(you)</span>}
            {user.disabled && <span className="ml-2 rounded bg-red-900/60 px-1.5 py-0.5 text-xs text-red-200">Disabled</span>}
          </div>
          <div className="text-xs text-gray-500">Created {new Date(user.created_at * 1000).toLocaleDateString()}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto"
            value={user.role}
            disabled={pending}
            onChange={(e) => run(() => updateUser(user.id, { role: e.target.value as User["role"] }))}
            aria-label={`Role for ${user.username}`}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn" disabled={pending} onClick={() => run(() => updateUser(user.id, { disabled: !user.disabled }))}>
            {user.disabled ? "Enable" : "Disable"}
          </button>
          <button className="btn" disabled={pending} onClick={() => setResetting((r) => !r)}>Reset password</button>
          <button className="btn" disabled={pending} onClick={() => run(() => revokeUserSessions(user.id))}>Sign out sessions</button>
          {!isSelf && (
            <button
              className="btn-danger"
              disabled={pending}
              onClick={() => confirm(`Delete ${user.username}? This cannot be undone.`) && run(() => deleteUser(user.id))}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {resetting && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await resetPassword(user.id, password);
              if (!r.error) {
                setPassword("");
                setResetting(false);
              }
              return r;
            });
          }}
        >
          <div className="min-w-56 flex-1">
            <label className="label" htmlFor={`reset-${user.id}`}>New password for {user.username}</label>
            <input
              className="input"
              id={`reset-${user.id}`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              maxLength={128}
            />
          </div>
          <button className="btn-primary" disabled={pending}>Set password</button>
        </form>
      )}
      <Alert state={state} />
    </li>
  );
}
