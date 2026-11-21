"use client";

// The Device page: data is loaded on the server and changes are sent through
// server actions.

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { connect, disconnect, saveDevice, setBrightness, setScores, setTimezone as saveTimezone } from "@/app/actions/device";
import { useToast } from "@/components/Toast";
import type { DeviceConfig } from "@/lib/config/model";
import { MdCircle } from 'react-icons/md';

export interface DeviceView {
  pixoo_mac: string;
  timezone: string;
  device_config: DeviceConfig;
}

export function DevicePage({ config, connected, manualDisconnect }: { config: DeviceView; connected: boolean; manualDisconnect: boolean }) {
  const onNotify = useToast();
  const router = useRouter();
  const onConfigUpdate = () => router.refresh();
  const [newMac, setNewMac] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [timezone, setTimezone] = useState(config.timezone || '');
  const [isConnected, setIsConnected] = useState(connected);
  const [isManualDisconnect, setIsManualDisconnect] = useState(manualDisconnect);

  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig>({
    brightness: config.device_config.brightness || 50,
    light_mode: config.device_config.light_mode || 'custom',
    environment_config: config.device_config.environment_config || {
      clock_design: 'digital',
      show_divoom: false,
      show_weather: false,
      show_temp: false,
      show_date: true,
      color: [255, 120, 0],
    },
    light_config: config.device_config.light_config || {
      color: [255, 255, 255],
      brightness: 50,
      effect_mode: 0,
      on: true,
    },
    score_config: config.device_config.score_config || {
      red_score: 0,
      blue_score: 0,
    },
    music_config: config.device_config.music_config || {
      mode: 'bottom_bars',
    },
    countdown_config: config.device_config.countdown_config || {
      presets: [
        { name: "1 Minute", minutes: 1, seconds: 0 },
        { name: "5 Minutes", minutes: 5, seconds: 0 },
        { name: "15 Minutes", minutes: 15, seconds: 0 },
        { name: "25 min (Pomodoro)", minutes: 25, seconds: 0 },
      ],
    },
  });

  useEffect(() => {
    setTimezone(config.timezone || '');
    if (config.device_config) {
      setDeviceConfig(config.device_config);
    }
  }, [config.timezone, config.device_config]);

  // Poll connection status (every 5 seconds, only when visible)
  useEffect(() => {
    const checkStatus = async () => {
      if (document.hidden) return; // Skip if tab not visible
      
      try {
        const response = await fetch('/api/connection-status', { cache: 'no-store' });
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
    const result = await disconnect();
    if (result.message) {
      onNotify('Disconnected - you can now use Divoom app');
      setIsConnected(false);
      setIsManualDisconnect(true);
      onConfigUpdate();
    } else {
      onNotify(result.error || 'Disconnect failed', 'error');
    }
  };

  const handleConnect = async () => {
    // An empty field reconnects to the saved device.
    const target = newMac.trim() || config.pixoo_mac;
    if (!target) {
      onNotify('Enter MAC address', 'error');
      return;
    }
    
    setConnecting(true);
    const result = await connect(target).finally(() => setConnecting(false));
    if (result.message) {
      onNotify('Connected!');
      setIsConnected(true);
      setIsManualDisconnect(false);
      onConfigUpdate();
      setNewMac('');
    } else {
      onNotify(result.error || 'Failed', 'error');
    }
  };

  // Brightness is live: it applies while dragging (debounced) and saves itself.
  const brightnessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBrightness = (value: number) => {
    setDeviceConfig(prev => ({ ...prev, brightness: value, light_config: { ...prev.light_config, brightness: value } }));
    if (brightnessTimer.current) clearTimeout(brightnessTimer.current);
    brightnessTimer.current = setTimeout(async () => {
      const result = await setBrightness(value);
      if (result.error) onNotify(result.error, 'error');
    }, 150);
  };

  // Scores update like the Tools page scoreboard: local at once, the latest
  // value sent once clicks pause.
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest scores, so rapid clicks build on each other instead of on the last render.
  const scores = useRef(deviceConfig.score_config);
  useEffect(() => {
    scores.current = config.device_config.score_config;
  }, [config.device_config]);
  const clampScore = (n: number) => Math.max(0, Math.min(999, Math.trunc(n) || 0));
  // While typing, a box may be briefly empty; it shows this text until blur.
  const [scoreText, setScoreText] = useState<{ red: string | null; blue: string | null }>({ red: null, blue: null });

  const commitScores = (next: { red_score: number; blue_score: number }) => {
    scores.current = next;
    setDeviceConfig(prev => ({ ...prev, score_config: next }));
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    scoreTimer.current = setTimeout(async () => {
      const result = await setScores(next.red_score, next.blue_score);
      if (result.error) onNotify(result.error, 'error');
    }, 150);
  };

  const updateScore = (team: 'red' | 'blue' | 'reset', delta: number) => {
    setScoreText({ red: null, blue: null });
    const cur = scores.current;
    commitScores(team === 'reset'
      ? { red_score: 0, blue_score: 0 }
      : { ...cur, [`${team}_score`]: clampScore(cur[`${team}_score`] + delta) });
  };

  /** Typed score: digits only, capped at 999, sent like a click. */
  const typeScore = (team: 'red' | 'blue', text: string) => {
    if (!/^\d{0,3}$/.test(text)) return;
    setScoreText(prev => ({ ...prev, [team]: text }));
    if (text !== '') commitScores({ ...scores.current, [`${team}_score`]: clampScore(Number(text)) });
  };

  const handleSaveTimezone = async () => {
    const result = await saveTimezone(timezone);
    if (result.message) {
      onNotify('Timezone saved!');
      onConfigUpdate();
    } else {
      onNotify(result.error || 'Save failed', 'error');
    }
  };

  const handleSaveDeviceConfig = async () => {
    const result = await saveDevice(deviceConfig);
    if (result.message) {
      onNotify('Device configuration saved!');
      onConfigUpdate();
    } else {
      onNotify(result.error || 'Failed to save device configuration', 'error');
    }
  };

  const mac = config.pixoo_mac || '';

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Device</h1>
      
      <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Connection</h3>
        
        <div className="mb-4">
          <label className="block text-muted text-sm mb-2">Status</label>
          <div className="flex items-center gap-3">
            <span className={`inline-block w-3 h-3 rounded-full ${isConnected ? 'bg-good text-good-ink animate-pulse' : isManualDisconnect ? 'bg-warn text-warn-ink' : 'bg-bad text-bad-ink'}`}></span>
            <span className="text-ink font-medium">
              {isConnected ? 'Connected' : isManualDisconnect ? 'Disconnected (Manual)' : 'Disconnected'}
            </span>
          </div>
        </div>
        
        <div className="mb-4">
          <label className="block text-muted text-sm mb-2">Current MAC</label>
          <code className="block bg-page px-4 py-3 rounded-lg font-mono text-accent text-lg">{mac || 'Not configured'}</code>
        </div>
        
        <div className="mb-4">
          <label className="block text-muted text-sm mb-2">Set MAC Address</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input 
              type="text" 
              value={newMac}
              onChange={(e) => setNewMac(e.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="flex-1 px-4 py-3 bg-surface border border-line rounded-lg text-ink text-base font-mono hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <div className="flex gap-3">
              <button className="flex-1 sm:flex-none px-6 py-3 bg-accent text-accent-ink rounded-lg text-base font-semibold cursor-pointer transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-wait" onClick={handleConnect} disabled={connecting}>{connecting ? 'Connecting...' : 'Connect'}</button>
              {isConnected && (
                <button className="flex-1 sm:flex-none px-6 py-3 bg-bad text-bad-ink rounded-lg text-base font-semibold cursor-pointer transition-all hover:brightness-110" onClick={handleDisconnect}>Disconnect</button>
              )}
            </div>
          </div>
          <p className="text-muted text-sm mt-2">
            {isManualDisconnect 
              ? "Disconnected - you can now use the Divoom app. Click Connect to reconnect."
              : "Find in the Divoom app under Device Settings"}
          </p>
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Brightness</h3>
        <label className="block text-muted text-sm mb-2">Brightness ({deviceConfig.brightness}%)</label>
        <input
          type="range"
          min="0"
          max="100"
          value={deviceConfig.brightness}
          onChange={(e) => handleBrightness(parseInt(e.target.value))}
          className="w-full h-2 bg-surface2 rounded-lg appearance-none cursor-pointer slider"
        />
        <div className="flex justify-between text-xs text-muted mt-1">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        <p className="text-muted text-sm mt-2">Applies to the device as you drag and is saved automatically. In Light mode it also sets the light&apos;s brightness.</p>
      </div>

      <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Timezone</h3>
        <div className="mb-4">
          <input 
            type="text" 
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
            className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-ink text-base hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <p className="text-muted text-sm mt-2">e.g., America/New_York, Europe/London, Asia/Tokyo</p>
        </div>
        <button className="px-6 py-3 bg-accent text-accent-ink rounded-lg text-base font-semibold cursor-pointer transition-all hover:brightness-110" onClick={handleSaveTimezone}>Save Timezone</button>
      </div>
      
      <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Device Configuration</h3>
        
        <div className="mb-6">
          <label className="block text-muted text-sm mb-2">Display Mode</label>
          <select 
            value={deviceConfig.light_mode}
            onChange={(e) => setDeviceConfig(prev => ({ ...prev, light_mode: e.target.value }))}
            className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-ink text-base hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <option value="custom">Custom Pages</option>
            <option value="env">Environment Mode</option>
            <option value="light">Light Mode</option>
            <option value="music">Music Mode</option>
            <option value="score">Score Mode</option>
            <option value="user">User Mode</option>
          </select>
          <p className="text-muted text-sm mt-2">
            {deviceConfig.light_mode === 'custom' 
              ? "Use your custom pages and designs" 
              : "Use Divoom's built-in display modes"}
          </p>
        </div>
        {deviceConfig.light_mode === 'env' && (
          <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">Environment Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-muted text-sm mb-2">Clock Design</label>
              <select 
                value={deviceConfig.environment_config.clock_design}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  environment_config: { ...prev.environment_config, clock_design: e.target.value }
                }))}
                className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-ink text-base hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
              <label className="block text-muted text-sm mb-2">Display Options</label>
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
                  <span className="text-ink">Show Cloud Channel</span>
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
                  <span className="text-ink">Show Weather</span>
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
                  <span className="text-ink">Show Temperature</span>
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
                  <span className="text-ink">Show Date</span>
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-muted text-sm mb-2">Accent Color</label>
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
                className="w-full h-10 bg-surface border border-line rounded-lg cursor-pointer"
              />
            </div>
          </div>
        )}

        {deviceConfig.light_mode === 'light' && (
          <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">Light Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-muted text-sm mb-2">Light Color</label>
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
                className="w-full h-10 bg-surface border border-line rounded-lg cursor-pointer"
              />
            </div>

            <div className="mb-4">
              <label className="block text-muted text-sm mb-2">Effect Mode</label>
              <select 
                value={deviceConfig.light_config.effect_mode}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  light_config: { ...prev.light_config, effect_mode: parseInt(e.target.value) }
                }))}
                className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-ink text-base hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                <span className="text-ink">Light On</span>
              </label>
            </div>
          </div>
        )}

        {deviceConfig.light_mode === 'music' && (
          <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">Music Mode Configuration</h3>
            
            <div className="mb-4">
              <label className="block text-muted text-sm mb-2">Visualization Style</label>
              <select 
                value={deviceConfig.music_config.mode}
                onChange={(e) => setDeviceConfig(prev => ({
                  ...prev,
                  music_config: { ...prev.music_config, mode: e.target.value }
                }))}
                className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-ink text-base hover:border-axis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
            <p className="text-muted text-sm">Music visualization reacts to ambient sound</p>
          </div>
        )}

        {deviceConfig.light_mode === 'score' && (
          <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">Score Mode Configuration</h3>
            
            {/* Same controls as the Tools page scoreboard. */}
            <div className="grid grid-cols-2 gap-6 mb-4">
              {/* Red Team */}
              <div className="bg-page rounded-lg p-4">
                <label className="block text-bad text-sm mb-2 font-semibold"><MdCircle className="inline h-3 w-3 mr-1 align-baseline" aria-hidden />Red Team</label>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => updateScore('red', -1)}
                    className="w-12 h-12 rounded-lg border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink text-ink text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    -
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Red score"
                    value={scoreText.red ?? String(deviceConfig.score_config.red_score)}
                    onChange={(e) => typeScore('red', e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => setScoreText(prev => ({ ...prev, red: null }))}
                    className="w-20 h-16 text-center bg-surface rounded-2xl border border-line shadow-card text-3xl font-bold text-bad focus:outline-none focus:ring-2 focus:ring-bad"
                  />
                  <button
                    onClick={() => updateScore('red', 1)}
                    className="w-12 h-12 rounded-lg bg-bad text-bad-ink hover:brightness-110 text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Blue Team */}
              <div className="bg-page rounded-lg p-4">
                <label className="block text-info text-sm mb-2 font-semibold"><MdCircle className="inline h-3 w-3 mr-1 align-baseline" aria-hidden />Blue Team</label>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => updateScore('blue', -1)}
                    className="w-12 h-12 rounded-lg border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink text-ink text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    -
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Blue score"
                    value={scoreText.blue ?? String(deviceConfig.score_config.blue_score)}
                    onChange={(e) => typeScore('blue', e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => setScoreText(prev => ({ ...prev, blue: null }))}
                    className="w-20 h-16 text-center bg-surface rounded-2xl border border-line shadow-card text-3xl font-bold text-info focus:outline-none focus:ring-2 focus:ring-info"
                  />
                  <button
                    onClick={() => updateScore('blue', 1)}
                    className="w-12 h-12 rounded-lg bg-info text-info-ink hover:brightness-110 text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => updateScore('reset', 0)}
                className="px-4 py-3 rounded-lg font-semibold transition-all bg-line hover:bg-surface2 text-ink"
              >
                Reset
              </button>
            </div>
            <p className="text-muted text-sm">Keep track of game scores. Click +/- or type a score (0-999); changes save automatically and show right away while Score mode is on.</p>
          </div>
        )}

        {deviceConfig.light_mode === 'user' && (
          <div className="bg-surface rounded-2xl border border-line shadow-card p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">User Mode Configuration</h3>
            <p className="text-muted">User mode uses custom GIFs uploaded to device through Divoom app.</p>
            <p className="text-muted text-sm mt-2">Note: Configure GIFs through Divoom mobile app, then select User mode here.</p>
          </div>
        )}

        <button className="px-6 py-3 bg-accent text-accent-ink rounded-lg text-base font-semibold cursor-pointer transition-all hover:brightness-110" onClick={handleSaveDeviceConfig}>Save Device Config</button>
      </div>
    </div>
  );
}
