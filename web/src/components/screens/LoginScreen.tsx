"use client";

import { useState } from "react";
import { login } from "@/app/actions/auth";

const inputClass =
  "w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-cyan-400";

export function LoginScreen({ notice }: { notice?: string | null }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Redirects on success.
    const r = await login(username.trim(), password);
    if (r?.error) {
      setError(r.error);
      setPassword("");
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pxls-logo.svg" alt="pxls" className="h-10 w-auto mx-auto" />
        {notice && <p className="text-sm text-amber-300 text-center">{notice}</p>}
        <input
          type="text"
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={inputClass}
        />
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-medium"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-xs text-gray-500 text-center">Accounts are created by an administrator.</p>
      </form>
    </div>
  );
}
