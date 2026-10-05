import { useState } from 'react';
import { AuthError, completeSetup } from '../auth';
import logo from '../assets/logo/pxls_logo.svg';

const inputClass =
  'w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-cyan-400';

/** First run: create the admin account with the one-time code printed in the server log. */
export function SetupScreen() {
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm !== '' && confirm !== password;
  const tooShort = password !== '' && password.length < 12;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeSetup(code.trim(), username.trim(), password);
    } catch (err) {
      setError(err instanceof AuthError || err instanceof Error ? err.message : 'Setup failed.');
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
        <img src={logo} alt="pxls" className="h-10 w-auto mx-auto" />
        <h1 className="text-xl font-semibold text-center">Create the admin account</h1>
        <p className="text-sm text-gray-400">
          pxls has no accounts yet. To prove you control this server, enter the one-time setup code from its log:
        </p>
        <pre className="bg-gray-900 rounded-lg p-3 text-xs text-cyan-300 overflow-x-auto">docker logs pxls-backend 2&gt;&amp;1 | grep -i "setup code"</pre>
        <input
          type="text"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Setup code (xxxx-xxxx-xxxx-...)"
          className={`${inputClass} font-mono`}
        />
        <input
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Admin username"
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (at least 12 characters)"
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat password"
          className={inputClass}
        />
        {tooShort && (
          <p className="text-sm text-amber-300">Password must be at least 12 characters ({password.length}/12).</p>
        )}
        {mismatch && <p className="text-sm text-amber-300">Passwords do not match.</p>}
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy || !code.trim() || !username.trim() || password.length < 12 || mismatch || !confirm}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-medium"
        >
          {busy ? 'Creating...' : 'Create admin and sign in'}
        </button>
      </form>
    </div>
  );
}
