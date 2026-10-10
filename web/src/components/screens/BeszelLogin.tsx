"use client";

// Ported from the original Vite UI (frontend/src on main) as-is.

import { apiFetch } from '@/ui/api';
import { useState, useEffect, useCallback } from 'react';
import type { Config, BeszelAuthStatus } from '@/ui/types';
import { API_URL } from '@/ui/types';

interface BeszelLoginProps {
  config: Config | null;
  onConfigUpdate: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export function BeszelLogin({ config, onConfigUpdate, onNotify }: BeszelLoginProps) {
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BeszelAuthStatus | null>(null);

  const saved = config?.beszel_auth;
  const hasSavedLogin = !!saved?.email;

  const loadStatus = useCallback(async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/beszel/status`);
      if (response.ok) setStatus(await response.json());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, config]);

  const openForm = () => {
    setEmail(saved?.email ?? '');
    setPassword('');
    setShowForm(true);
  };

  const postConfig = async (beszel_auth: { email: string; password: string }) => {
    const response = await apiFetch(`${API_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, beszel_auth }),
    });
    return response.json();
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const response = await apiFetch(`${API_URL}/api/beszel/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (result.success) onNotify('Login works!');
      else onNotify(result.error || 'Login failed', 'error');
    } catch {
      onNotify('Could not reach the pixoo backend', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!config || !email.trim()) {
      onNotify('Enter the Beszel email', 'error');
      return;
    }
    if (!password && !saved?.password_set) {
      onNotify('Enter the Beszel password', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await postConfig({ email: email.trim(), password });
      if (result.success) {
        onNotify('Beszel login saved');
        setShowForm(false);
        setPassword('');
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to save login', 'error');
      }
    } catch {
      onNotify('Failed to save login', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!config || !confirm('Remove the saved Beszel login? Beszel pages will stop updating.')) return;
    setBusy(true);
    try {
      // An empty email tells the backend to clear the stored login.
      const result = await postConfig({ email: '', password: '' });
      if (result.success) {
        onNotify('Beszel login removed');
        setShowForm(false);
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to remove login', 'error');
      }
    } catch {
      onNotify('Failed to remove login', 'error');
    } finally {
      setBusy(false);
    }
  };

  const formatTime = (timestamp?: number | null) =>
    timestamp ? new Date(timestamp * 1000).toLocaleString() : 'unknown';

  const renderStatus = () => {
    if (!status) return <span className="text-gray-500">Status unavailable</span>;
    if (status.mode === 'none') {
      return <span className="text-yellow-400">Not configured. Beszel pages will show offline.</span>;
    }
    if (status.mode === 'legacy_token') {
      return (
        <span className="text-yellow-400">
          Using an old pasted token (expires {formatTime(status.token_expires)}). Add a login so this never needs
          updating.
        </span>
      );
    }
    if (status.logged_in) {
      return (
        <span className="text-green-400">
          Logged in. Renews itself automatically (current token valid until {formatTime(status.token_expires)}).
        </span>
      );
    }
    if (status.last_error) {
      return <span className="text-red-400">Login failing: {status.last_error}</span>;
    }
    return <span className="text-gray-400">Will log in on the next Beszel page render.</span>;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Beszel Login</h3>
        <button
          className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-all hover:bg-cyan-700"
          onClick={() => (showForm ? setShowForm(false) : openForm())}
        >
          {showForm ? 'Cancel' : hasSavedLogin ? 'Edit Login' : '+ Add Login'}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-900 p-4 rounded-lg mb-4">
          <p className="text-xs text-gray-400 mb-4">
            Use a dedicated read-only Beszel user for pixoo. Pixoo logs in with it by itself, so there is no token to
            paste or renew.
          </p>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Beszel user email</label>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pixoo@example.com"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={saved?.password_set ? 'Saved (leave blank to keep)' : 'Password'}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-blue-700 disabled:opacity-50"
              onClick={handleTest}
              disabled={busy}
            >
              Test login
            </button>
            <button
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-green-700 disabled:opacity-50"
              onClick={handleSave}
              disabled={busy}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-900 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex-1 text-sm">
          {hasSavedLogin && <div className="text-white font-semibold mb-1">{saved?.email}</div>}
          <div className="text-xs">{renderStatus()}</div>
        </div>
        {hasSavedLogin && (
          <button
            className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
            onClick={handleClear}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
