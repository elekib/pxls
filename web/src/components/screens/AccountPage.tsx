"use client";

// Sessions come from the server render.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changePassword, logoutEverywhere, revokeSession } from "@/app/actions/auth";
import { useToast } from "@/components/Toast";
import type { User } from "@/lib/auth/accounts";

export interface Session {
  id: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
  current: boolean;
}

const inputClass = "w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-cyan-400";
const fmt = (secs: number) => new Date(secs * 1000).toLocaleString();

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function AccountPage({ user, sessions }: { user: User; sessions: Session[] }) {
  const onNotify = useToast();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      onNotify("New passwords do not match", "error");
      return;
    }
    setSaving(true);
    // Redirects to sign-in on success.
    const r = await changePassword(current, next);
    if (r?.error) {
      onNotify(r.error, "error");
      setSaving(false);
    }
  };

  const revoke = async (id: string) => {
    const r = await revokeSession(id);
    if (r.error) onNotify(r.error, "error");
    else {
      onNotify("Session signed out");
      router.refresh();
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Account</h1>

      <div className="bg-gray-800 rounded-xl p-6">
        <div className="text-lg font-semibold">{user.username}</div>
        <div className="text-sm text-gray-400">{user.role === "admin" ? "Administrator" : "Viewer (read-only)"}</div>
      </div>

      <form onSubmit={submit} className="bg-gray-800 rounded-xl p-6 space-y-3">
        <h2 className="text-xl font-semibold">Change password</h2>
        <p className="text-sm text-gray-400">Changing your password signs you out on every device.</p>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        <input type="password" autoComplete="new-password" placeholder="New password (at least 12 characters)" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        <input type="password" autoComplete="new-password" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        {next !== "" && next.length < 12 && <p className="text-sm text-amber-300">New password must be at least 12 characters ({next.length}/12).</p>}
        {confirm !== "" && confirm !== next && <p className="text-sm text-amber-300">Passwords do not match.</p>}
        <button
          type="submit"
          disabled={saving || !current || next.length < 12 || next !== confirm}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-medium"
        >
          {saving ? "Saving..." : "Change password"}
        </button>
      </form>

      <div className="bg-gray-800 rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-semibold">Active sessions</h2>
          <form action={logoutEverywhere}>
            <button className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg border border-gray-600">Sign out everywhere</button>
          </form>
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-500">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-gray-700">
            {sessions.map((s) => (
              <li key={s.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {describeAgent(s.user_agent)} {s.current && <span className="ml-2 px-2 py-0.5 text-xs bg-green-700 rounded">This device</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                    {s.ip ?? "unknown address"} · signed in {fmt(s.created_at)} · last active {fmt(s.last_used_at)}
                  </div>
                </div>
                {!s.current && (
                  <button onClick={() => revoke(s.id)} className="shrink-0 px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 rounded-lg">
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
