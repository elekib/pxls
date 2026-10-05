import {
  apiFetch,
  AUTH_REQUIRED_EVENT,
  FORBIDDEN_EVENT,
  endLocalSession,
  fetchAuthStatus,
  logout,
  onUserChange,
  refreshSession,
  type User,
} from './auth';
import { LoginScreen } from './components/LoginScreen';
import { SetupScreen } from './components/SetupScreen';
import { AccountPage } from './pages/AccountPage';
import { UsersPage } from './pages/UsersPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { DevicePage } from './pages/DevicePage';
import { PagesPage } from './pages/PagesPage';
import { ToolsPage } from './pages/ToolsPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { WebhookEventsPage } from './pages/WebhookEventsPage';
import type { Config, Notification, Tab } from './types';
import { API_URL } from './types';
import horizontalLogo from './assets/logo/pxls_logo.svg';

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  // 'checking' until we know whether a session exists and whether first-run setup is needed.
  const [boot, setBoot] = useState<'checking' | 'setup' | 'login' | 'error'>('checking');
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('device');
  const [notification, setNotification] = useState<Notification | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const showNotification = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/config`);
      if (response.status === 401) return;
      const data = await response.json();
      setConfig(data);
      setLoading(false);
    } catch (error) {
      showNotification('Failed to load config', 'error');
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchAuthStatus();
        if (cancelled) return;
        if (status.setup_required) {
          setBoot('setup');
          return;
        }
        await refreshSession();
        if (!cancelled) setBoot('login');
      } catch {
        if (!cancelled) setBoot('error');
      }
    })();
    const off = onUserChange((u) => {
      setUser(u);
      if (u) {
        setNotice(null);
        setLoading(true);
      } else {
        setConfig(null);
      }
    });
    const onAuthRequired = () => setNotice('Your session expired. Please sign in again.');
    const onForbidden = () => showNotification('Your account is read-only. Ask an admin for changes.', 'error');
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    window.addEventListener(FORBIDDEN_EVENT, onForbidden);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
      window.removeEventListener(FORBIDDEN_EVENT, onForbidden);
    };
  }, [showNotification]);

  useEffect(() => {
    if (user) loadConfig();
  }, [user, loadConfig]);

  // Land on a tab this role can use (viewers have no Webhooks or Users pages).
  useEffect(() => {
    if (user?.role !== 'admin' && (activeTab === 'users' || activeTab === 'webhooks' || activeTab === 'diagnostics')) setActiveTab('device');
  }, [user, activeTab]);

  const signOut = () => {
    void logout();
  };

  if (!user) {
    if (boot === 'checking') {
      return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-gray-400 text-lg">Loading...</div>;
    }
    if (boot === 'error') {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-gray-300 gap-3 p-4 text-center">
          <p>Could not reach the pxls server.</p>
          <button className="px-4 py-2 bg-cyan-600 rounded-lg" onClick={() => window.location.reload()}>Retry</button>
        </div>
      );
    }
    return boot === 'setup' ? <SetupScreen /> : <LoginScreen notice={notice} />;
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400 text-lg">Loading...</div>;
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
      {notification && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-[100] font-medium max-w-[90vw] md:max-w-[400px] ${
          notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {notification.message}
        </div>
      )}
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar config={config} activeTab={activeTab} onTabChange={setActiveTab} user={user} onSignOut={signOut} />
      </div>
      
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Mobile Sidebar Drawer */}
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 md:hidden ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <Sidebar 
          config={config} 
          activeTab={activeTab} 
          onTabChange={(tab) => {
            setActiveTab(tab);
            setSidebarOpen(false);
          }}
          onClose={() => setSidebarOpen(false)}
          user={user}
          onSignOut={signOut}
        />
      </div>
      
      <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20 md:pb-8">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center gap-3 mb-4">
          <button 
            onClick={() => setSidebarOpen(true)}
            className="p-2 bg-gray-800 rounded-lg border border-gray-700"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <img src={horizontalLogo} alt="pxls" className="h-8 w-auto" />
        </div>
        
        {activeTab === 'device' && (
          <DevicePage config={config} onConfigUpdate={loadConfig} onNotify={showNotification} />
        )}
        {activeTab === 'pages' && (
          <PagesPage config={config} onConfigUpdate={loadConfig} onNotify={showNotification} />
        )}
        {activeTab === 'tools' && (
          <ToolsPage config={config} onConfigUpdate={loadConfig} onNotify={showNotification} />
        )}
        {activeTab === 'webhooks' && (
          <WebhooksPage onNotify={showNotification} />
        )}
        {activeTab === 'webhook_events' && (
          <WebhookEventsPage onNotify={showNotification} />
        )}
        {activeTab === 'account' && (
          <AccountPage
            user={user}
            onNotify={showNotification}
            onPasswordChanged={() => {
              endLocalSession();
              setNotice('Password changed. Sign in again with the new password.');
            }}
          />
        )}
        {activeTab === 'users' && user.role === 'admin' && <UsersPage me={user} onNotify={showNotification} />}
        {activeTab === 'diagnostics' && user.role === 'admin' && <DiagnosticsPage onNotify={showNotification} />}
      </main>
      
      {/* Mobile Bottom Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} isAdmin={user.role === 'admin'} />
    </div>
  );
}

export default App;
