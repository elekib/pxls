import { apiFetch } from '../auth';
import { useState, useEffect, type ChangeEvent, type FocusEvent } from 'react';
import type { Config, DeviceConfig } from '../types';
import { API_URL } from '../types';

interface DevicePageProps {
  config: Config | null;
  onConfigUpdate: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export function DevicePage({ config, onConfigUpdate, onNotify }: DevicePageProps) {
  const [newMac, setNewMac] = useState('');
  const [timezone, setTimezone] = useState(config?.timezone || '');
  const [isConnected, setIsConnected] = useState(false);
  const [isManualDisconnect, setIsManualDisconnect] = useState(false);
  const [redScoreStr, setRedScoreStr] = useState(String(config?.device_config?.score_config?.red_score || 0));
  const [blueScoreStr, setBlueScoreStr] = useState(String(config?.device_config?.score_config?.blue_score || 0));

  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig>({
    brightness: config?.device_config?.brightness || 50,
    time_format: config?.device_config?.time_format || '12h',
    light_mode: config?.device_config?.light_mode || 'custom',
    environment_config: config?.device_config?.environment_config || {
      time_format: '12h',
      clock_design: 'digital',
      show_divoom: false,
      show_weather: false,
      show_temp: false,
      show_date: true,
      color: [255, 120, 0],
    },
    light_config: config?.device_config?.light_config || {
      color: [255, 255, 255],
      brightness: 50,
      effect_mode: 0,
      on: true,
    },
    score_config: config?.device_config?.score_config || {
      red_score: 0,
      blue_score: 0,
    },
    special_config: config?.device_config?.special_config || {
      mode: 'default',
    },
    music_config: config?.device_config?.music_config || {
      mode: 'bottom_bars',
    },
    countdown_config: config?.device_config?.countdown_config || {
      presets: [
        { name: "1 Minute", minutes: 1, seconds: 0 },
        { name: "5 Minutes", minutes: 5, seconds: 0 },
        { name: "15 Minutes", minutes: 15, seconds: 0 },
        { name: "25 min (Pomodoro)", minutes: 25, seconds: 0 },
      ],
    },
  });

  useEffect(() => {
    setTimezone(config?.timezone || '');
    if (config?.device_config) {
      setDeviceConfig(config.device_config);
      setRedScoreStr(String(config.device_config.score_config?.red_score || 0));
      setBlueScoreStr(String(config.device_config.score_config?.blue_score || 0));
    }
  }, [config?.timezone, config?.device_config]);

  // Poll connection status (every 5 seconds, only when visible)
  useEffect(() => {
    const checkStatus = async () => {
      if (document.hidden) return; // Skip if tab not visible
      
      try {
        const response = await apiFetch(`${API_URL}/api/connection-status`);
        const status = await response.json();
        setIsConnected(status.connected);
        setIsManualDisconnect(status.manual_disconnect);
      } catch (error) {
        setIsConnected(false);
      }
    };
    
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDisconnect = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      
      if (result.success) {
        onNotify('Disconnected - you can now use Divoom app');
        setIsConnected(false);
        setIsManualDisconnect(true);
      } else {
        onNotify(result.error || 'Disconnect failed', 'error');
      }
    } catch (error) {
      onNotify('Disconnect failed', 'error');
    }
  };

  const handleConnect = async () => {
    if (!newMac.trim()) {
      onNotify('Enter MAC address', 'error');
      return;
    }
    
    try {
      const response = await apiFetch(`${API_URL}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: newMac })
      });
      const result = await response.json();
      
      if (result.success) {
        onNotify('Connected!');
        onConfigUpdate();
        setNewMac('');
      } else {
        onNotify(result.error || 'Failed', 'error');
      }
    } catch (error) {
      onNotify('Connection failed', 'error');
    }
  };

  const handleSaveTimezone = async () => {
    if (!config) return;
    const newConfig = { ...config, timezone };
    
    try {
      const response = await apiFetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const result = await response.json();
      
      if (result.success) {
        onNotify('Timezone saved!');
        onConfigUpdate();
      }
    } catch (error) {
      onNotify('Save failed', 'error');
    }
  };

  const handleSaveDeviceConfig = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/device-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deviceConfig)
      });
      const result = await response.json();
      
      if (result.success) {
        onNotify('Device configuration saved!');
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to save device configuration', 'error');
      }
    } catch (error) {
      onNotify('Save failed', 'error');
    }
  };

  const mac = config?.pixoo_mac || '';

  return (
    <div className="max-w-[900px]">
      <h2 className="text-[30px] font-bold text-cyan-400 mb-6">Device</h2>
      
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-cyan-600">
        <h3 className="text-xl font-semibold mb-4 text-cyan-300">Connection</h3>
        
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Status</label>
          <div className="flex items-center gap-3">
            <span className={`inline-block w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : isManualDisconnect ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
            <span className="text-white font-medium">
              {isConnected ? 'Connected' : isManualDisconnect ? 'Disconnected (Manual)' : 'Disconnected'}
            </span>
          </div>
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Current MAC</label>
          <code className="block bg-gray-900 px-4 py-3 rounded-lg font-mono text-cyan-400 text-lg">{mac || 'Not configured'}</code>
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Set MAC Address</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input 
              type="text" 
              value={newMac}
              onChange={(e) => setNewMac(e.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base font-mono focus:outline-none focus:border-cyan-400"
            />
            <div className="flex gap-3">
              <button className="flex-1 sm:flex-none px-6 py-3 bg-green-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-green-700" onClick={handleConnect}>Connect</button>
              {isConnected && (
                <button className="flex-1 sm:flex-none px-6 py-3 bg-red-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-red-700" onClick={handleDisconnect}>Disconnect</button>
              )}
            </div>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            {isManualDisconnect 
              ? "Disconnected - you can now use the Divoom app. Click Connect to reconnect."
              : "Find in Divoom app → Device Settings"}
          </p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-purple-600">
        <h3 className="text-xl font-semibold mb-4 text-purple-300">Timezone</h3>
        <div className="mb-4">
          <input 
            type="text" 
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
          />
          <p className="text-gray-500 text-sm mt-2">e.g., America/New_York, Europe/London, Asia/Tokyo</p>
        </div>
        <button className="px-6 py-3 bg-purple-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-purple-700" onClick={handleSaveTimezone}>Save Timezone</button>
      </div>
      
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-orange-600">
        <h3 className="text-xl font-semibold mb-4 text-orange-300">Device Configuration</h3>
        
        <div className="mb-6">
          <label className="block text-gray-400 text-sm mb-2">Brightness ({deviceConfig.brightness}%)</label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={deviceConfig.brightness}
            onChange={(e) => setDeviceConfig(prev => ({ ...prev, brightness: parseInt(e.target.value) }))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <p className="text-gray-500 text-sm mt-2">Adjust device brightness (0-100%)</p>
        </div>

        <div className="mb-6">
          <label className="block text-gray-400 text-sm mb-2">Display Mode</label>
          <select 
            value={deviceConfig.light_mode}
            onChange={(e) => setDeviceConfig(prev => ({ ...prev, light_mode: e.target.value }))}
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
          >
            <option value="custom">Custom Pages</option>
            <option value="env">Environment Mode</option>
            <option value="light">Light Mode</option>
            <option value="music">Music Mode</option>
            <option value="score">Score Mode</option>
            <option value="special">Special Mode</option>
            <option value="user">User Mode</option>
          </select>
          <p className="text-gray-500 text-sm mt-2">
            {deviceConfig.light_mode === 'custom' 
              ? "Use your custom pages and designs" 
              : "Use Divoom's built-in display modes"}
          </p>
        </div>
        {deviceConfig.light_mode === 'env' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-green-600">
            <h3 className="text-xl font-semibold mb-4 text-green-300">Environment Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Time Format</label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="radio" 
                    name="env_time_format" 
                    value="12h"
                    checked={deviceConfig.environment_config.time_format === '12h'}
                    onChange={(e) => setDeviceConfig(prev => ({
                      ...prev,
                      environment_config: { ...prev.environment_config, time_format: e.target.value }
                    }))}
                    className="mr-2"
                  />
                  <span className="text-white">12 Hour</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="radio" 
                    name="env_time_format" 
                    value="24h"
                    checked={deviceConfig.environment_config.time_format === '24h'}
                    onChange={(e) => setDeviceConfig(prev => ({
                      ...prev,
                      environment_config: { ...prev.environment_config, time_format: e.target.value }
                    }))}
                    className="mr-2"
                  />
                  <span className="text-white">24 Hour</span>
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Clock Design</label>
              <select 
                value={deviceConfig.environment_config.clock_design}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  environment_config: { ...prev.environment_config, clock_design: e.target.value }
                }))}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-green-400"
              >
                <option value="analog1">Analog 1</option>
                <option value="analog2">Analog 2</option>
                <option value="digital">Digital</option>
                <option value="digital_box">Digital Box</option>
                <option value="digital_inverted">Digital Inverted</option>
                <option value="digital_rainbow">Digital Rainbow</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Display Options</label>
              <div className="space-y-2">
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={deviceConfig.environment_config.show_divoom}
                    onChange={(e) => setDeviceConfig(prev => ({
                      ...prev,
                      environment_config: { ...prev.environment_config, show_divoom: e.target.checked }
                    }))}
                    className="mr-2"
                  />
                  <span className="text-white">Show Divoom Logo</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={deviceConfig.environment_config.show_weather}
                    onChange={(e) => setDeviceConfig(prev => ({
                      ...prev,
                      environment_config: { ...prev.environment_config, show_weather: e.target.checked }
                    }))}
                    className="mr-2"
                  />
                  <span className="text-white">Show Weather</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={deviceConfig.environment_config.show_temp}
                    onChange={(e) => setDeviceConfig(prev => ({
                      ...prev,
                      environment_config: { ...prev.environment_config, show_temp: e.target.checked }
                    }))}
                    className="mr-2"
                  />
                  <span className="text-white">Show Temperature</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={deviceConfig.environment_config.show_date}
                    onChange={(e) => setDeviceConfig(prev => ({
                      ...prev,
                      environment_config: { ...prev.environment_config, show_date: e.target.checked }
                    }))}
                    className="mr-2"
                  />
                  <span className="text-white">Show Date</span>
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Accent Color</label>
              <input 
                type="color" 
                value={`#${deviceConfig.environment_config.color.map(c => c.toString(16).padStart(2, '0')).join('')}`}
                onChange={(e) => {
                  const hex = e.target.value.replace('#', '');
                  const color = [
                    parseInt(hex.substr(0, 2), 16),
                    parseInt(hex.substr(2, 2), 16),
                    parseInt(hex.substr(4, 2), 16)
                  ];
                  setDeviceConfig(prev => ({
                    ...prev,
                    environment_config: { ...prev.environment_config, color: color as [number, number, number] }
                  }));
                }}
                className="w-full h-10 bg-gray-700 border border-gray-600 rounded cursor-pointer"
              />
            </div>
          </div>
        )}

        {deviceConfig.light_mode === 'light' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-yellow-600">
            <h3 className="text-xl font-semibold mb-4 text-yellow-300">Light Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Light Color</label>
              <input 
                type="color" 
                value={`#${deviceConfig.light_config.color.map(c => c.toString(16).padStart(2, '0')).join('')}`}
                onChange={(e) => {
                  const hex = e.target.value.replace('#', '');
                  const color = [
                    parseInt(hex.substr(0, 2), 16),
                    parseInt(hex.substr(2, 2), 16),
                    parseInt(hex.substr(4, 2), 16)
                  ];
                  setDeviceConfig(prev => ({
                    ...prev,
                    light_config: { ...prev.light_config, color: color as [number, number, number] }
                  }));
                }}
                className="w-full h-10 bg-gray-700 border border-gray-600 rounded cursor-pointer"
              />
            </div>

            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Brightness ({deviceConfig.light_config.brightness}%)</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={deviceConfig.light_config.brightness}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  light_config: { ...prev.light_config, brightness: parseInt(e.target.value) }
                }))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Effect Mode</label>
              <select 
                value={deviceConfig.light_config.effect_mode}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  light_config: { ...prev.light_config, effect_mode: parseInt(e.target.value) }
                }))}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-yellow-400"
              >
                <option value="3">Fly</option>
                <option value="0">Normal</option>
                <option value="2">Plants</option>
                <option value="1">Rainbow</option>
                <option value="4">Sleep</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={deviceConfig.light_config.on}
                  onChange={(e) => setDeviceConfig(prev => ({
                    ...prev,
                    light_config: { ...prev.light_config, on: e.target.checked }
                  }))}
                  className="mr-2"
                />
                <span className="text-white">Light On</span>
              </label>
            </div>
          </div>
        )}

        {deviceConfig.light_mode === 'special' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-red-600">
            <h3 className="text-xl font-semibold mb-4 text-red-300">Special Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Special Effect</label>
              <select 
                value={deviceConfig.special_config.mode}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  special_config: { ...prev.special_config, mode: e.target.value }
                }))}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-red-400"
              >
                <option value="breath">Breath</option>
                <option value="default">Default</option>
                <option value="sparkle">Sparkle</option>
                <option value="wave">Wave</option>
              </select>
            </div>
            <p className="text-gray-400 text-sm">Special visual effects for the display</p>
          </div>
        )}

        {deviceConfig.light_mode === 'music' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-indigo-600">
            <h3 className="text-xl font-semibold mb-4 text-indigo-300">Music Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">Visualization Style</label>
              <select 
                value={deviceConfig.music_config.mode}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  music_config: { ...prev.music_config, mode: e.target.value }
                }))}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-indigo-400"
              >
                <option value="bottom_bars">Bottom Bars</option>
                <option value="center_bars">Center Bars</option>
                <option value="dancing_boy">Dancing Boy</option>
                <option value="dancing_girl">Dancing Girl</option>
                <option value="face1">Face 1</option>
                <option value="face2">Face 2</option>
                <option value="face3">Face 3</option>
                <option value="falling_blocks">Falling Blocks</option>
                <option value="fireworks">Fireworks</option>
                <option value="frog_face">Frog Face</option>
                <option value="matrix">Matrix</option>
                <option value="side_bars">Side Bars</option>
              </select>
            </div>
            <p className="text-gray-400 text-sm">Music visualization reacts to ambient sound</p>
          </div>
        )}

        {deviceConfig.light_mode === 'score' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-blue-600">
            <h3 className="text-xl font-semibold mb-4 text-blue-300">Score Mode Configuration</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Red Score (0-999)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={redScoreStr}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setRedScoreStr(val);
                      const num = parseInt(val) || 0;
                      setDeviceConfig(prev => ({
                        ...prev,
                        score_config: { ...prev.score_config, red_score: Math.min(999, Math.max(0, num)) }
                      }));
                    }
                  }}
                  onBlur={(e: FocusEvent<HTMLInputElement>) => {
                    const num = parseInt(e.target.value) || 0;
                    const clamped = Math.min(999, Math.max(0, num));
                    setDeviceConfig(prev => ({
                      ...prev,
                      score_config: { ...prev.score_config, red_score: clamped }
                    }));
                    setRedScoreStr(String(clamped));
                  }}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Blue Score (0-999)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={blueScoreStr}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setBlueScoreStr(val);
                      const num = parseInt(val) || 0;
                      setDeviceConfig(prev => ({
                        ...prev,
                        score_config: { ...prev.score_config, blue_score: Math.min(999, Math.max(0, num)) }
                      }));
                    }
                  }}
                  onBlur={(e: FocusEvent<HTMLInputElement>) => {
                    const num = parseInt(e.target.value) || 0;
                    const clamped = Math.min(999, Math.max(0, num));
                    setDeviceConfig(prev => ({
                      ...prev,
                      score_config: { ...prev.score_config, blue_score: clamped }
                    }));
                    setBlueScoreStr(String(clamped));
                  }}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <p className="text-gray-400 text-sm">Keep track of game scores</p>
          </div>
        )}

        {deviceConfig.light_mode === 'user' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-purple-600">
            <h3 className="text-xl font-semibold mb-4 text-purple-300">User Mode Configuration</h3>
            <p className="text-gray-400">User mode uses custom GIFs uploaded to device through Divoom app.</p>
            <p className="text-gray-400 text-sm mt-2">Note: Configure GIFs through Divoom mobile app, then select User mode here.</p>
          </div>
        )}

        <button className="px-6 py-3 bg-orange-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-orange-700" onClick={handleSaveDeviceConfig}>Save Device Config</button>
      </div>
    </div>
  );
}
