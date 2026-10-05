import { useState } from 'react';
import { setToken, verifyToken } from '../auth';
import logo from '../assets/logo/pxls_horizontal_icon.png';

export function LoginScreen({ onSuccess, expired }: { onSuccess: () => void; expired?: boolean }) {
  const [token, setTokenValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setChecking(true);
    setError(null);
    if (await verifyToken(value)) {
      setToken(value);
      onSuccess();
    } else {
      setError('That token was not accepted. Check PXLS_AUTH_TOKEN on the server.');
    }
    setChecking(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
        <img src={logo} alt="pxls" className="h-10 w-auto mx-auto" />
        <p className="text-sm text-gray-400 text-center">
          {expired ? 'Your session expired. ' : ''}Enter the API token (<code>PXLS_AUTH_TOKEN</code>) to continue.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="API token"
          className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-cyan-400"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={checking || !token.trim()}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-medium"
        >
          {checking ? 'Checking...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
