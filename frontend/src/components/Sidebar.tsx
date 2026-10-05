import { useEffect, useState } from 'react';
import type { Config, Tab } from '../types';
import type { User } from '../auth';
import logoHorizontal from '../assets/logo/pxls_logo.svg';

interface SidebarProps {
  config: Config | null;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  user: User;
  onClose?: () => void;
  onSignOut?: () => void;
}

export function Sidebar({ config, activeTab, onTabChange, user, onClose, onSignOut }: SidebarProps) {
  const mac = config?.pixoo_mac || '';
  const isAdmin = user.role === 'admin';
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        if (h?.version) setVersion(h.git_sha && h.git_sha !== 'unknown' ? `${h.version} (${String(h.git_sha).slice(0, 7)})` : h.version);
      })
      .catch(() => {});
  }, []);

  return (
    <aside className="w-64 h-full bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-6 border-b border-gray-700 flex items-center justify-between">
        <img src={logoHorizontal} alt="pxls" className="max-w-full h-auto max-h-[70px]" />
        {onClose && (
          <button 
            onClick={onClose}
            className="md:hidden p-2 text-gray-400 hover:text-white"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      
      <nav className="flex-1 py-4">
        <button 
          className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
            activeTab === 'device' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
          }`}
          onClick={() => onTabChange('device')}
        >
          <span className="text-xl mr-3">📱</span>
          <span>Device</span>
        </button>
        <button
          className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
            activeTab === 'pages' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
          }`}
          onClick={() => onTabChange('pages')}
        >
          <span className="text-xl mr-3">🎨</span>
          <span>Pages</span>
        </button>
        <button
          className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
            activeTab === 'tools' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
          }`}
          onClick={() => onTabChange('tools')}
        >
          <span className="text-xl mr-3">🧰</span>
          <span>Tools</span>
        </button>
        {isAdmin && (
        <button
            className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
              activeTab === 'webhooks' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
            }`}
            onClick={() => onTabChange('webhooks')}
          >
            <span className="text-xl mr-3">🔔</span>
            <span>Webhooks</span>
          </button>
        )}
        <button
          className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
            activeTab === 'webhook_events' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
          }`}
          onClick={() => onTabChange('webhook_events')}
        >
          <span className="text-xl mr-3">📊</span>
          <span>Event Logs</span>
        </button>
        {isAdmin && (
        <button
            className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
              activeTab === 'users' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
            }`}
            onClick={() => onTabChange('users')}
          >
            <span className="text-xl mr-3">👥</span>
            <span>Users</span>
          </button>
        )}
        <button
          className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
            activeTab === 'account' ? 'bg-cyan-600 border-r-4 border-cyan-400 text-white' : ''
          }`}
          onClick={() => onTabChange('account')}
        >
          <span className="text-xl mr-3">👤</span>
          <span>Account</span>
        </button>
      </nav>
      
      <div className="p-4 border-t border-gray-700">
        <div className="bg-gray-900 rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400 text-xs">Status</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
              mac ? 'bg-green-600' : 'bg-gray-600'
            }`}>
              {mac ? 'Connected' : 'Offline'}
            </span>
          </div>
          <code className="text-cyan-400 font-mono text-xs break-all">{mac || 'Not set'}</code>
        </div>
        <div className="mt-3 text-xs text-gray-400 text-center">
          Signed in as <span className="text-gray-200">{user.username}</span> ({user.role})
        </div>
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="mt-2 w-full py-2 text-sm text-gray-400 hover:text-white bg-gray-900 rounded-lg border border-gray-700"
          >
            Sign out
          </button>
        )}
        {version && <div className="mt-3 text-center text-xs text-gray-500">pxls {version}</div>}
      </div>
    </aside>
  );
}
