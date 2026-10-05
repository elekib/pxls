import { useCallback, useEffect, useState } from 'react';
import { accountRequest, type Role, type User } from '../auth';

interface Props {
  me: User;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const inputClass = 'px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-cyan-400';
const btn = 'px-2.5 py-1 text-xs rounded-lg border border-gray-600 bg-gray-700 hover:bg-gray-600';

export function UsersPage({ me, onNotify }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await accountRequest<{ users: User[] }>('/api/users');
      setUsers(data.users);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Could not load users', 'error');
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      onNotify(ok);
      void load();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Request failed', 'error');
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(() => accountRequest('/api/users', 'POST', { username: username.trim(), password, role }), 'User created');
    setUsername('');
    setPassword('');
  };

  const remove = (u: User) => {
    if (window.confirm(`Delete ${u.username}? Their sessions end immediately.`)) {
      void run(() => accountRequest(`/api/users/${u.id}`, 'DELETE'), 'User deleted');
    }
  };

  const submitReset = async (u: User) => {
    await run(
      () => accountRequest(`/api/users/${u.id}/password`, 'POST', { new_password: resetPw }),
      `Password reset for ${u.username}; their sessions were ended`,
    );
    setResetFor(null);
    setResetPw('');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Users</h1>

      <form onSubmit={create} className="bg-gray-800 rounded-xl p-6 space-y-3">
        <h2 className="text-xl font-semibold">Add user</h2>
        <div className="flex flex-wrap gap-3">
          <input className={`${inputClass} flex-1 min-w-[10rem]`} placeholder="Username" autoComplete="off" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className={`${inputClass} flex-1 min-w-[12rem]`} type="password" autoComplete="new-password" placeholder="Password (12+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer (read-only)</option>
          </select>
          <button type="submit" disabled={!username.trim() || password.length < 12} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-medium">
            Create
          </button>
        </div>
        {password !== '' && password.length < 12 && (
          <p className="text-sm text-amber-300">Password must be at least 12 characters ({password.length}/12).</p>
        )}
        <p className="text-xs text-gray-500">Share the password with the person over a private channel; they can change it on their Account page.</p>
      </form>

      <div className="bg-gray-800 rounded-xl p-6">
        <ul className="divide-y divide-gray-700">
          {users.map((u) => (
            <li key={u.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-medium">{u.username}</span>
                  {u.id === me.id && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                  <span className={`ml-2 px-2 py-0.5 text-xs rounded ${u.role === 'admin' ? 'bg-cyan-700' : 'bg-gray-600'}`}>{u.role}</span>
                  {u.disabled && <span className="ml-2 px-2 py-0.5 text-xs rounded bg-red-800">disabled</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={btn} onClick={() => run(() => accountRequest(`/api/users/${u.id}`, 'PATCH', { role: u.role === 'admin' ? 'viewer' : 'admin' }), 'Role updated')}>
                    Make {u.role === 'admin' ? 'viewer' : 'admin'}
                  </button>
                  <button className={btn} onClick={() => run(() => accountRequest(`/api/users/${u.id}`, 'PATCH', { disabled: !u.disabled }), u.disabled ? 'User enabled' : 'User disabled')}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button className={btn} onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setResetPw(''); }}>
                    Reset password
                  </button>
                  <button className={btn} onClick={() => run(() => accountRequest(`/api/users/${u.id}/sessions`, 'DELETE'), 'Sessions revoked')}>
                    Revoke sessions
                  </button>
                  {u.id !== me.id && (
                    <button className={`${btn} !bg-red-800 hover:!bg-red-700`} onClick={() => remove(u)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {resetFor === u.id && (
                <div className="flex gap-2 flex-wrap">
                  <input className={`${inputClass} flex-1 min-w-[12rem]`} type="password" autoComplete="new-password" placeholder="New password (12+ characters)" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                  <button className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm" disabled={resetPw.length < 12} onClick={() => void submitReset(u)}>
                    Set password
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
