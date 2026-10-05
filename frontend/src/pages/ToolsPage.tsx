import { apiFetch } from '../auth';
import { useState, useEffect } from 'react';
import type { Config, CountdownPreset, DeviceConfig } from '../types';
import { API_URL } from '../types';

interface ToolsPageProps {
  config: Config | null;
  onConfigUpdate: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

interface ToolStatus {
  active: boolean;
  tool_type: string | null;
  remaining_seconds: number;
}

export function ToolsPage({ config, onConfigUpdate, onNotify }: ToolsPageProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [toolStatus, setToolStatus] = useState<ToolStatus>({
    active: false,
    tool_type: null,
    remaining_seconds: 0
  });
  const [customMinutes, setCustomMinutes] = useState(5);
  const [customSeconds, setCustomSeconds] = useState(0);

  // Scoreboard state
  const [redScore, setRedScore] = useState(0);
  const [blueScore, setBlueScore] = useState(0);

  const [countdownConfig, setCountdownConfig] = useState<{
    presets: CountdownPreset[];
    buzzer_active_time_ms: number;
    buzzer_off_time_ms: number;
    buzzer_total_time_ms: number;
  }>({
    presets: config?.device_config?.countdown_config?.presets || [
      { name: "1 Minute", minutes: 1, seconds: 0 },
      { name: "5 Minutes", minutes: 5, seconds: 0 },
      { name: "15 Minutes", minutes: 15, seconds: 0 },
      { name: "25 min (Pomodoro)", minutes: 25, seconds: 0 },
    ],
    buzzer_active_time_ms: config?.device_config?.countdown_config?.buzzer_active_time_ms || 500,
    buzzer_off_time_ms: config?.device_config?.countdown_config?.buzzer_off_time_ms || 0,
    buzzer_total_time_ms: config?.device_config?.countdown_config?.buzzer_total_time_ms || 1000,
  });

  useEffect(() => {
    if (config?.device_config?.countdown_config) {
      setCountdownConfig(config.device_config.countdown_config);
    }
  }, [config?.device_config?.countdown_config]);

  // Poll connection and tool status (every 5 seconds, only when visible)
  useEffect(() => {
    const checkStatus = async () => {
      if (document.hidden) return; // Skip if tab not visible

      try {
        const response = await apiFetch(`${API_URL}/api/connection-status`);
        const status = await response.json();
        setIsConnected(status.connected);

        // Check tool status from backend
        if (status.tool_active_until) {
          const now = Date.now();
          const toolUntil = new Date(status.tool_active_until).getTime();
          const remaining = Math.max(0, Math.floor((toolUntil - now) / 1000));
          setToolStatus({
            active: remaining > 0,
            tool_type: status.tool_type || 'countdown',
            remaining_seconds: remaining
          });
        } else {
          setToolStatus({ active: false, tool_type: null, remaining_seconds: 0 });
        }
      } catch (error) {
        setIsConnected(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartCountdown = async (minutes: number, seconds: number) => {
    try {
      const response = await apiFetch(`${API_URL}/api/countdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes, seconds })
      });
      const result = await response.json();

      if (result.success) {
        onNotify(`Countdown started: ${minutes}m ${seconds}s`);
        setToolStatus({
          active: true,
          tool_type: 'countdown',
          remaining_seconds: minutes * 60 + seconds
        });
      } else {
        onNotify(result.error || 'Countdown failed', 'error');
      }
    } catch (error) {
      onNotify('Countdown failed - device may not be connected', 'error');
    }
  };

  const handleStopTool = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/stop-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Tool stopped - reconnecting to device');
        setToolStatus({ active: false, tool_type: null, remaining_seconds: 0 });
      } else {
        onNotify(result.error || 'Failed to stop tool', 'error');
      }
    } catch (error) {
      onNotify('Failed to stop tool', 'error');
    }
  };

  const handleTestBuzzer = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/buzzer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_time: countdownConfig.buzzer_active_time_ms,
          off_time: countdownConfig.buzzer_off_time_ms,
          total_time: countdownConfig.buzzer_total_time_ms
        })
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Buzzer activated!');
      } else {
        onNotify(result.error || 'Buzzer failed', 'error');
      }
    } catch (error) {
      onNotify('Buzzer test failed - device may not be connected', 'error');
    }
  };

  const handleSetScoreboard = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/scoreboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ red_score: redScore, blue_score: blueScore })
      });
      const result = await response.json();

      if (result.success) {
        onNotify(`Scoreboard set: Red ${redScore} - Blue ${blueScore}`);
        setToolStatus({
          active: true,
          tool_type: 'scoreboard',
          remaining_seconds: 86400
        });
      } else {
        onNotify(result.error || 'Failed to set scoreboard', 'error');
      }
    } catch (error) {
      onNotify('Failed to set scoreboard - device may not be connected', 'error');
    }
  };

  // Update score dynamically - updates local state and sends to device
  const updateScore = async (team: 'red' | 'blue' | 'reset', delta: number) => {
    console.log('updateScore called:', { team, delta, redScore, blueScore, toolStatus });

    // Always read current state values at execution time
    let newRed = Number(redScore) || 0;
    let newBlue = Number(blueScore) || 0;

    if (team === 'reset') {
      newRed = 0;
      newBlue = 0;
      setRedScore(0);
      setBlueScore(0);
    } else if (team === 'red') {
      newRed = Math.max(0, Math.min(999, newRed + delta));
      setRedScore(newRed);
    } else if (team === 'blue') {
      newBlue = Math.max(0, Math.min(999, newBlue + delta));
      setBlueScore(newBlue);
    }

    console.log('New scores calculated:', { newRed, newBlue, toolStatusActive: toolStatus.active, toolType: toolStatus.tool_type });

    // Only send to device if scoreboard is already active
    if (toolStatus.active && toolStatus.tool_type === 'scoreboard') {
      console.log('Sending score update to API:', { red_score: newRed, blue_score: newBlue });
      try {
        const response = await apiFetch(`${API_URL}/api/scoreboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ red_score: newRed, blue_score: newBlue })
        });
        const result = await response.json();
        console.log('API response:', result);

        if (!result.success) {
          onNotify(result.error || 'Failed to update score', 'error');
        }
      } catch (error) {
        console.error('API error:', error);
        onNotify('Failed to update score - device may not be connected', 'error');
      }
    } else {
      console.log('Skipping API call - scoreboard not active or wrong tool type');
    }
  };

  const handleSoundDetector = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/sound-detector`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Sound detector started (5 min)');
        setToolStatus({
          active: true,
          tool_type: 'sound_detector',
          remaining_seconds: 300
        });
      } else {
        onNotify(result.error || 'Sound detector failed', 'error');
      }
    } catch (error) {
      onNotify('Sound detector failed - device may not be connected', 'error');
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;

    const newDeviceConfig: DeviceConfig = {
      ...config.device_config,
      countdown_config: countdownConfig
    };

    try {
      const response = await apiFetch(`${API_URL}/api/device-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDeviceConfig)
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Timer settings saved!');
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to save settings', 'error');
      }
    } catch (error) {
      onNotify('Save failed', 'error');
    }
  };

  const updatePreset = (index: number, field: keyof CountdownPreset, value: string | number) => {
    setCountdownConfig(prev => ({
      ...prev,
      presets: prev.presets.map((preset, i) =>
        i === index ? { ...preset, [field]: value } : preset
      )
    }));
  };

  const addPreset = () => {
    setCountdownConfig(prev => ({
      ...prev,
      presets: [...prev.presets, { name: "New Timer", minutes: 10, seconds: 0 }]
    }));
  };

  const removePreset = (index: number) => {
    setCountdownConfig(prev => ({
      ...prev,
      presets: prev.presets.filter((_, i) => i !== index)
    }));
  };

  return (
    <div className="max-w-[900px]">
      <h2 className="text-[30px] font-bold text-cyan-400 mb-6">Tools</h2>

      {/* Status Section */}
      <div className={`bg-gray-800 rounded-lg p-6 mb-6 border-l-4 ${
        toolStatus.active ? 'border-yellow-500' : isConnected ? 'border-green-500' : 'border-red-500'
      }`}>
        <h3 className="text-xl font-semibold mb-4 text-gray-200">Device Status</h3>

        <div className="flex items-center gap-3 mb-4">
          <span className={`inline-block w-3 h-3 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`}></span>
          <span className="text-white font-medium">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {toolStatus.active && (
          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">
                  {toolStatus.tool_type === 'countdown' ? '⏱️' : toolStatus.tool_type === 'sound_detector' ? '🎤' : '🔧'}
                </span>
                <div>
                  <p className="text-yellow-400 font-semibold">
                    {toolStatus.tool_type === 'countdown' ? 'Countdown Active' :
                     toolStatus.tool_type === 'sound_detector' ? 'Sound Detector Active' :
                     'Tool Active'}
                  </p>
                  <p className="text-gray-400 text-sm">
                    Time remaining: <span className="text-yellow-300 font-mono text-lg">{formatTime(toolStatus.remaining_seconds)}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={handleStopTool}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-all"
              >
                Stop
              </button>
            </div>
            <p className="text-gray-500 text-sm mt-2">
              Device is running a native tool. Display will resume when timer completes or you click Stop.
            </p>
          </div>
        )}
      </div>

      {/* Countdown Section */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-blue-600">
        <h3 className="text-xl font-semibold mb-4 text-blue-300">Countdown Timer</h3>

        {/* Presets */}
        <div className="mb-6">
          <label className="block text-gray-400 text-sm mb-3">Quick Presets</label>
          <div className="flex flex-wrap gap-3">
            {countdownConfig.presets.map((preset, index) => (
              <button
                key={index}
                onClick={() => handleStartCountdown(preset.minutes, preset.seconds)}
                disabled={!isConnected || toolStatus.active}
                className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                  isConnected && !toolStatus.active
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Timer */}
        <div className="bg-gray-900 rounded-lg p-4 mb-4">
          <label className="block text-gray-400 text-sm mb-3">Custom Timer</label>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-gray-500 text-xs mb-1">Minutes</label>
              <input
                type="number"
                min="0"
                max="99"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Math.min(99, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center"
              />
            </div>
            <div className="flex-1">
              <label className="block text-gray-500 text-xs mb-1">Seconds</label>
              <input
                type="number"
                min="0"
                max="59"
                value={customSeconds}
                onChange={(e) => setCustomSeconds(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center"
              />
            </div>
          </div>
          <button
            onClick={() => handleStartCountdown(customMinutes, customSeconds)}
            disabled={!isConnected || toolStatus.active}
            className={`w-full py-3 rounded-lg font-semibold transition-all ${
              isConnected && !toolStatus.active
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Start {customMinutes}m {customSeconds}s Countdown
          </button>
        </div>
      </div>

      {/* Buzzer Section */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-yellow-600">
        <h3 className="text-xl font-semibold mb-4 text-yellow-300">Buzzer</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-gray-400 text-sm mb-1">Active Time (ms)</label>
            <input
              type="number"
              min="0"
              max="5000"
              value={countdownConfig.buzzer_active_time_ms}
              onChange={(e) => setCountdownConfig(prev => ({ ...prev, buzzer_active_time_ms: parseInt(e.target.value) || 0 }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-sm mb-1">Off Time (ms)</label>
            <input
              type="number"
              min="0"
              max="5000"
              value={countdownConfig.buzzer_off_time_ms}
              onChange={(e) => setCountdownConfig(prev => ({ ...prev, buzzer_off_time_ms: parseInt(e.target.value) || 0 }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-sm mb-1">Total Time (ms)</label>
            <input
              type="number"
              min="100"
              max="10000"
              value={countdownConfig.buzzer_total_time_ms}
              onChange={(e) => setCountdownConfig(prev => ({ ...prev, buzzer_total_time_ms: parseInt(e.target.value) || 100 }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            />
          </div>
        </div>

        <button
          onClick={handleTestBuzzer}
          disabled={!isConnected || toolStatus.active}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${
            isConnected && !toolStatus.active
              ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          🔊 Test Buzzer
        </button>
      </div>

      {/* Scoreboard */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-red-600">
        <h3 className="text-xl font-semibold mb-4 text-red-300">Scoreboard</h3>
        <p className="text-gray-400 text-sm mb-4">
          Display a scoreboard with Red vs Blue scores. Click "Start Scoreboard" to activate, then use +/- to update scores instantly.
        </p>

        {/* Score Controls */}
        <div className="grid grid-cols-2 gap-6 mb-4">
          {/* Red Team */}
          <div className="bg-gray-900 rounded-lg p-4">
            <label className="block text-red-400 text-sm mb-2 font-semibold">🔴 Red Team</label>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => updateScore('red', -1)}
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                -
              </button>
              <div className="w-20 h-16 flex items-center justify-center bg-gray-800 rounded-lg">
                <span className="text-3xl font-bold text-red-400">{redScore}</span>
              </div>
              <button
                onClick={() => updateScore('red', 1)}
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg bg-red-600 hover:bg-red-700 text-white text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          </div>

          {/* Blue Team */}
          <div className="bg-gray-900 rounded-lg p-4">
            <label className="block text-blue-400 text-sm mb-2 font-semibold">🔵 Blue Team</label>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => updateScore('blue', -1)}
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                -
              </button>
              <div className="w-20 h-16 flex items-center justify-center bg-gray-800 rounded-lg">
                <span className="text-3xl font-bold text-blue-400">{blueScore}</span>
              </div>
              <button
                onClick={() => updateScore('blue', 1)}
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          {!toolStatus.active || toolStatus.tool_type !== 'scoreboard' ? (
            <button
              onClick={handleSetScoreboard}
              disabled={!isConnected || (toolStatus.active && toolStatus.tool_type !== 'scoreboard')}
              className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
                isConnected && (!toolStatus.active || toolStatus.tool_type === 'scoreboard')
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              🏆 Start Scoreboard
            </button>
          ) : (
            <button
              onClick={handleStopTool}
              className="flex-1 py-3 rounded-lg font-semibold bg-gray-600 hover:bg-gray-700 text-white transition-all"
            >
              ⏹ Stop Scoreboard
            </button>
          )}
          <button
            onClick={() => { setRedScore(0); setBlueScore(0); updateScore('reset', 0); }}
            disabled={!isConnected}
            className={`px-4 py-3 rounded-lg font-semibold transition-all ${
              isConnected
                ? 'bg-gray-600 hover:bg-gray-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Reset
          </button>
        </div>

        {/* Status Indicator */}
        {toolStatus.active && toolStatus.tool_type === 'scoreboard' && (
          <div className="mt-4 p-3 bg-green-900/50 border border-green-700 rounded-lg">
            <p className="text-green-400 text-sm font-semibold">✅ Scoreboard Active - Scores update instantly!</p>
          </div>
        )}
      </div>

      {/* Sound Detector */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-green-600">
        <h3 className="text-xl font-semibold mb-4 text-green-300">Sound Detector</h3>
        <p className="text-gray-400 text-sm mb-4">
          Display a real-time noise meter on the Pixoo. Runs for 5 minutes or until stopped.
        </p>
        <button
          onClick={handleSoundDetector}
          disabled={!isConnected || toolStatus.active}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${
            isConnected && !toolStatus.active
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          🎤 Start Sound Detector (5 min)
        </button>
      </div>

      {/* Preset Configuration */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-purple-600">
        <h3 className="text-xl font-semibold mb-4 text-purple-300">Timer Presets</h3>
        <p className="text-gray-400 text-sm mb-4">
          Customize the quick preset buttons. Changes are saved to device configuration.
        </p>

        <div className="space-y-3 mb-4">
          {countdownConfig.presets.map((preset, index) => (
            <div key={index} className="flex items-center gap-3 bg-gray-900 rounded-lg p-3">
              <input
                type="text"
                value={preset.name}
                onChange={(e) => updatePreset(index, 'name', e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                placeholder="Preset name"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={preset.minutes}
                  onChange={(e) => updatePreset(index, 'minutes', parseInt(e.target.value) || 0)}
                  className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center"
                />
                <span className="text-gray-400">m</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={preset.seconds}
                  onChange={(e) => updatePreset(index, 'seconds', parseInt(e.target.value) || 0)}
                  className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center"
                />
                <span className="text-gray-400">s</span>
              </div>
              <button
                onClick={() => removePreset(index)}
                className="p-2 text-red-400 hover:text-red-300 transition-all"
                title="Remove preset"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={addPreset}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-all"
          >
            + Add Preset
          </button>
          <button
            onClick={handleSaveConfig}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
