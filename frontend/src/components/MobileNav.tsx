interface MobileNavProps {
  activeTab: 'device' | 'pages' | 'tools' | 'webhooks' | 'webhook_events';
  onTabChange: (tab: 'device' | 'pages' | 'tools' | 'webhooks' | 'webhook_events') => void;
}

export function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 md:hidden z-30">
      <div className="flex">
        <button 
          className={`flex-1 flex flex-col items-center py-3 px-4 transition-all ${
            activeTab === 'device' 
              ? 'text-cyan-400 bg-gray-700/50' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onTabChange('device')}
        >
          <span className="text-xl mb-1">📱</span>
          <span className="text-xs font-medium">Device</span>
        </button>
        <button
          className={`flex-1 flex flex-col items-center py-3 px-4 transition-all ${
            activeTab === 'pages'
              ? 'text-cyan-400 bg-gray-700/50'
              : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onTabChange('pages')}
        >
          <span className="text-xl mb-1">🎨</span>
          <span className="text-xs font-medium">Pages</span>
        </button>
        <button
          className={`flex-1 flex flex-col items-center py-3 px-4 transition-all ${
            activeTab === 'tools'
              ? 'text-cyan-400 bg-gray-700/50'
              : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onTabChange('tools')}
        >
          <span className="text-xl mb-1">🧰</span>
          <span className="text-xs font-medium">Tools</span>
        </button>
        <button
          className={`flex-1 flex flex-col items-center py-3 px-4 transition-all ${
            activeTab === 'webhooks'
              ? 'text-cyan-400 bg-gray-700/50'
              : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onTabChange('webhooks')}
        >
          <span className="text-xl mb-1">🔔</span>
          <span className="text-xs font-medium">Webhooks</span>
        </button>
        <button
          className={`flex-1 flex flex-col items-center py-3 px-4 transition-all ${
            activeTab === 'webhook_events'
              ? 'text-cyan-400 bg-gray-700/50'
              : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onTabChange('webhook_events')}
        >
          <span className="text-xl mb-1">📊</span>
          <span className="text-xs font-medium">Events</span>
        </button>
      </div>
    </nav>
  );
}
