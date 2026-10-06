import { apiFetch } from '../auth';
import { useState, useEffect, useRef } from 'react';
import type { Config, CountdownConfig, CountdownPreset, DeviceConfig } from '../types';
import { API_URL } from '../types';
import {
  NO_TOOL,
  clampScore,
  formatTime,
  parseToolStatus,
  toolLabel,
  type ConnectionStatusResponse,
  type ToolKind,
  type ToolStatus,
} from '../utils/toolStatus';

interface ToolsPageProps {
  config: Config | null;
  onConfigUpdate: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const SCORE_DEBOUNCE_MS = 150;

const DEFAULT_PRESETS: CountdownPreset[] = [
  { name: "1 Minute", minutes: 1, seconds: 0 },
  { name: "5 Minutes", minutes: 5, seconds: 0 },
  { name: "15 Minutes", minutes: 15, seconds: 0 },
  { name: "25 min (Pomodoro)", minutes: 25, seconds: 0 },
];

export function ToolsPage({ config, onConfigUpdate, onNotify }: ToolsPageProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [toolStatus, setToolStatus] = useState<ToolStatus>(NO_TOOL);
  // Wall-clock moment the running timer ends, so the display ticks between polls.
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [customMinutes, setCustomMinutes] = useState(5);
  const [customSeconds, setCustomSeconds] = useState(0);

  // Scoreboard state. Refs hold the latest values for the debounced sender.
  const [redScore, setRedScore] = useState(0);
  const [blueScore, setBlueScore] = useState(0);
  const scores = useRef({ red: 0, blue: 0 });
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendChain = useRef<Promise<void>>(Promise.resolve());

  const savedCountdown = config?.device_config?.countdown_config;
  const [presets, setPresets] = useState<CountdownPreset[]>(
    savedCountdown?.presets || DEFAULT_PRESETS
  );
  const [buzzerTotal, setBuzzerTotal] = useState(savedCountdown?.buzzer_total_time_ms || 1000);

  useEffect(() => {
    if (savedCountdown) {
      setPresets(savedCountdown.presets);
      setBuzzerTotal(savedCountdown.buzzer_total_time_ms);
    }
  }, [savedCountdown]);

  useEffect(() => () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
  }, []);

  // Poll connection and tool status (every 5 seconds, only when visible)
  useEffect(() => {
    const checkStatus = async () => {
      if (document.hidden) return; // Skip if tab not visible

      try {
        const response = await apiFetch(`${API_URL}/api/connection-status`);
        const status: ConnectionStatusResponse = await response.json();
        setIsConnected(Boolean(status.connected));
        applyToolStatus(parseToolStatus(status));
      } catch {
        setIsConnected(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const applyToolStatus = (status: ToolStatus) => {
    setToolStatus(status);
    setDeadline(status.remainingSeconds === null ? null : Date.now() + status.remainingSeconds * 1000);
  };

  // Tick once a second while a timer is running.
  useEffect(() => {
    if (deadline === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [deadline]);

  const remainingSeconds =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

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
        applyToolStatus({ active: true, kind: 'countdown', remainingSeconds: minutes * 60 + seconds });
      } else {
        onNotify(result.error || 'Countdown failed', 'error');
      }
    } catch {
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
        onNotify('Tool stopped');
        applyToolStatus(NO_TOOL);
      } else {
        onNotify(result.error || 'Failed to stop tool', 'error');
      }
    } catch {
      onNotify('Failed to stop tool', 'error');
    }
  };

  const handleTestBuzzer = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/buzzer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total_time: buzzerTotal })
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Buzzer activated!');
      } else {
        onNotify(result.error || 'Buzzer failed', 'error');
      }
    } catch {
      onNotify('Buzzer test failed - device may not be connected', 'error');
    }
  };

  // Posts the latest scores. Requests are chained so they reach the device in order.
  const postScores = () => {
    sendChain.current = sendChain.current.then(async () => {
      const { red, blue } = scores.current;
      try {
        const response = await apiFetch(`${API_URL}/api/scoreboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ red_score: red, blue_score: blue })
        });
        const result = await response.json();
        if (result.success) {
          applyToolStatus({ active: true, kind: 'scoreboard', remainingSeconds: null });
        } else {
          onNotify(result.error || 'Failed to update scoreboard', 'error');
        }
      } catch {
        onNotify('Failed to update scoreboard - device may not be connected', 'error');
      }
    });
  };

  const handleStartScoreboard = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    postScores();
  };

  // Updates local scores at once and sends only the latest value once clicks pause.
  const updateScore = (team: 'red' | 'blue' | 'reset', delta: number) => {
    const next =
      team === 'reset'
        ? { red: 0, blue: 0 }
        : {
            red: team === 'red' ? clampScore(scores.current.red + delta) : scores.current.red,
            blue: team === 'blue' ? clampScore(scores.current.blue + delta) : scores.current.blue,
          };
    scores.current = next;
    setRedScore(next.red);
    setBlueScore(next.blue);

    if (toolStatus.kind === 'scoreboard') {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      sendTimer.current = setTimeout(postScores, SCORE_DEBOUNCE_MS);
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
        applyToolStatus({ active: true, kind: 'sound_detector', remainingSeconds: 300 });
      } else {
        onNotify(result.error || 'Sound detector failed', 'error');
      }
    } catch {
      onNotify('Sound detector failed - device may not be connected', 'error');
    }
  };

  // Saves only the given part of the countdown config; everything else stays as
  // saved, so editing presets never writes unsaved buzzer values and vice versa.
  const saveCountdownConfig = async (patch: Partial<CountdownConfig>, doneMessage: string) => {
    if (!config) return;

    const newDeviceConfig: DeviceConfig = {
      ...config.device_config,
      countdown_config: { ...config.device_config.countdown_config, ...patch }
    };

    try {
      const response = await apiFetch(`${API_URL}/api/device-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDeviceConfig)
      });
      const result = await response.json();

      if (result.success) {
        onNotify(doneMessage);
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to save settings', 'error');
      }
    } catch {
      onNotify('Save failed', 'error');
    }
  };

  const handleSavePresets = () => saveCountdownConfig({ presets }, 'Timer presets saved!');
  const handleSaveBuzzer = () => saveCountdownConfig({ buzzer_total_time_ms: buzzerTotal }, 'Buzzer settings saved!');

  const updatePreset = (index: number, field: keyof CountdownPreset, value: string | number) => {
    setPresets(prev => prev.map((preset, i) => (i === index ? { ...preset, [field]: value } : preset)));
  };

  const addPreset = () => {
    setPresets(prev => [...prev, { name: "New Timer", minutes: 10, seconds: 0 }]);
  };

  const removePreset = (index: number) => {
    setPresets(prev => prev.filter((_, i) => i !== index));
  };

  const isRunning = (kind: ToolKind) => toolStatus.kind === kind;
  const cardClass = (kind: ToolKind, border: string) =>
    `bg-gray-800 rounded-lg p-6 mb-6 border-l-4 ${isRunning(kind) ? 'border-yellow-500 ring-1 ring-yellow-600/60' : border}`;
  // Shown at the top of the running tool's card, so Stop sits next to its timer.
  const runningBanner = (kind: ToolKind) =>
    isRunning(kind) && (
      <div className="flex items-center justify-between gap-3 bg-yellow-900/30 border border-yellow-600 rounded-lg px-4 py-3 mb-4">
        <div>
          <p className="text-yellow-400 font-semibold">{toolLabel(kind)}</p>
          {remainingSeconds !== null && (
            <p className="text-gray-400 text-sm">
              Time remaining: <span className="text-yellow-300 font-mono text-lg">{formatTime(remainingSeconds)}</span>
            </p>
          )}
        </div>
        <button
          onClick={handleStopTool}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-all"
        >
          Stop
        </button>
      </div>
    );
  const canStart = isConnected && !toolStatus.active;
  const startButton = (enabled: boolean, color: string) =>
    enabled ? `${color} text-white` : 'bg-gray-700 text-gray-500 cursor-not-allowed';

  return (
    <div className="max-w-[900px]">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-[30px] font-bold text-cyan-400">Tools</h2>
        <span className="flex items-center gap-2 text-sm text-gray-400">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Countdown Section */}
      <div className={cardClass('countdown', 'border-blue-600')}>
        <h3 className="text-xl font-semibold mb-4 text-blue-300">Countdown Timer</h3>
        {runningBanner('countdown')}

        {/* Presets: start, edit and save in one place */}
        <div className="mb-6">
          <label className="block text-gray-400 text-sm mb-3">Presets</label>
          <div className="space-y-3 mb-4">
            {presets.map((preset, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3 bg-gray-900 rounded-lg p-3">
                <input
                  type="text"
                  value={preset.name}
                  onChange={(e) => updatePreset(index, 'name', e.target.value)}
                  className="flex-1 min-w-[120px] px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                  placeholder="Preset name"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={preset.minutes}
                    onChange={(e) => updatePreset(index, 'minutes', Math.min(99, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center"
                  />
                  <span className="text-gray-400">m</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={preset.seconds}
                    onChange={(e) => updatePreset(index, 'seconds', Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center"
                  />
                  <span className="text-gray-400">s</span>
                </div>
                <button
                  onClick={() => handleStartCountdown(preset.minutes, preset.seconds)}
                  disabled={!canStart}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-blue-600 hover:bg-blue-700')}`}
                >
                  Start
                </button>
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
              onClick={handleSavePresets}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all"
            >
              Save Presets
            </button>
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
            disabled={!canStart || (customMinutes === 0 && customSeconds === 0)}
            className={`w-full py-3 rounded-lg font-semibold transition-all ${startButton(canStart && (customMinutes > 0 || customSeconds > 0), 'bg-blue-600 hover:bg-blue-700')}`}
          >
            Start {customMinutes}m {customSeconds}s Countdown
          </button>
        </div>
      </div>

      {/* Buzzer Section */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-yellow-600">
        <h3 className="text-xl font-semibold mb-4 text-yellow-300">Buzzer</h3>

        <div className="mb-4 max-w-xs">
          <label className="block text-gray-400 text-sm mb-1">Total Time (ms)</label>
          <input
            type="number"
            min="100"
            max="10000"
            value={buzzerTotal}
            onChange={(e) => setBuzzerTotal(parseInt(e.target.value) || 100)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleTestBuzzer}
            disabled={!canStart}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-yellow-600 hover:bg-yellow-700')}`}
          >
            🔊 Test Buzzer
          </button>
          <button
            onClick={handleSaveBuzzer}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all"
          >
            Save Buzzer
          </button>
        </div>
      </div>

      {/* Scoreboard */}
      <div className={cardClass('scoreboard', 'border-red-600')}>
        <h3 className="text-xl font-semibold mb-4 text-red-300">Scoreboard</h3>
        {runningBanner('scoreboard')}
        <p className="text-gray-400 text-sm mb-4">
          Display a scoreboard with Red vs Blue scores. Click "Start Scoreboard" to activate, then use +/- to update scores. Use Stop above to end it.
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
          {!isRunning('scoreboard') && (
            <button
              onClick={handleStartScoreboard}
              disabled={!canStart}
              className={`flex-1 py-3 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-red-600 hover:bg-red-700')}`}
            >
              🏆 Start Scoreboard
            </button>
          )}
          <button
            onClick={() => updateScore('reset', 0)}
            disabled={!isConnected}
            className={`px-4 py-3 rounded-lg font-semibold transition-all ${startButton(isConnected, 'bg-gray-600 hover:bg-gray-700')}`}
          >
            Reset
          </button>
        </div>

      </div>

      {/* Sound Detector */}
      <div className={cardClass('sound_detector', 'border-green-600')}>
        <h3 className="text-xl font-semibold mb-4 text-green-300">Sound Detector</h3>
        {runningBanner('sound_detector')}
        <p className="text-gray-400 text-sm mb-4">
          Display a real-time noise meter on the Pixoo. Runs for 5 minutes or until stopped.
        </p>
        <button
          onClick={handleSoundDetector}
          disabled={!canStart}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-green-600 hover:bg-green-700')}`}
        >
          🎤 Start Sound Detector (5 min)
        </button>
      </div>
    </div>
  );
}
