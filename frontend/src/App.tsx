import { apiFetch, AUTH_REQUIRED_EVENT, clearToken, getToken } from './auth';
import { LoginScreen } from './components/LoginScreen';
import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { DevicePage } from './pages/DevicePage';
import { PagesPage } from './pages/PagesPage';
import { ToolsPage } from './pages/ToolsPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { WebhookEventsPage } from './pages/WebhookEventsPage';
import type { Config, Notification } from './types';
import { API_URL } from './types';
import horizontalLogo from './assets/logo/pxls_logo.svg';

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [expired, setExpired] = useState(false);
  const [activeTab, setActiveTab] = useState<'device' | 'pages' | 'tools' | 'webhooks' | 'webhook_events'>('device');
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
    const onAuthRequired = () => {
      setExpired(true);
      setAuthed(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  useEffect(() => {
    if (authed) loadConfig();
  }, [authed, loadConfig]);

  const signOut = () => {
    clearToken();
    setConfig(null);
    setExpired(false);
    setAuthed(false);
  };

  if (!authed) {
    return (
      <LoginScreen
        expired={expired}
        onSuccess={() => {
          setExpired(false);
          setLoading(true);
          setAuthed(true);
        }}
      />
    );
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
        <Sidebar config={config} activeTab={activeTab} onTabChange={setActiveTab} onSignOut={signOut} />
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
      </main>
      
      {/* Mobile Bottom Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

export default App;
