"use client";

import { apiFetch } from '@/ui/api';
import { useState, useEffect, useRef } from 'react';
import type { Config, CountdownConfig, CountdownPreset, DeviceConfig } from '@/ui/types';
import { API_URL } from '@/ui/types';
import { MdCircle, MdEmojiEvents, MdMic } from 'react-icons/md';
import {
  NO_TOOL,
  clampScore,
  formatTime,
  parseToolStatus,
  toolLabel,
  type ConnectionStatusResponse,
  type ToolKind,
  type ToolStatus,
} from '@/ui/toolStatus';

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

  useEffect(() => {
    if (savedCountdown) {
      setPresets(savedCountdown.presets);
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
    setScoreText({ red: null, blue: null });
    applyScores(next);
  };

  const applyScores = (next: { red: number; blue: number }) => {
    scores.current = next;
    setRedScore(next.red);
    setBlueScore(next.blue);

    if (toolStatus.kind === 'scoreboard') {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      sendTimer.current = setTimeout(postScores, SCORE_DEBOUNCE_MS);
    }
  };

  // Typed score (same as the Device page): digits only, capped at 999. While
  // typing, a box may be briefly empty; it shows the text until blur.
  const [scoreText, setScoreText] = useState<{ red: string | null; blue: string | null }>({ red: null, blue: null });
  const typeScore = (team: 'red' | 'blue', text: string) => {
    if (!/^\d{0,3}$/.test(text)) return;
    setScoreText(prev => ({ ...prev, [team]: text }));
    if (text !== '') applyScores({ ...scores.current, [team]: clampScore(Number(text)) });
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

  // Saves only the given part of the countdown config; everything else stays as saved.
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
    `bg-surface rounded-2xl border border-line shadow-card p-6 mb-6 border-l-4 ${isRunning(kind) ? 'border-warn ring-1 ring-warn' : border}`;
  // Shown at the top of the running tool's card, so Stop sits next to its timer.
  const runningBanner = (kind: ToolKind) =>
    isRunning(kind) && (
      <div className="flex items-center justify-between gap-3 bg-warn-soft border border-warn rounded-lg px-4 py-3 mb-4">
        <div>
          <p className="text-warn font-semibold">{toolLabel(kind)}</p>
          {remainingSeconds !== null && (
            <p className="text-muted text-sm">
              Time remaining: <span className="text-warn font-mono text-lg">{formatTime(remainingSeconds)}</span>
            </p>
          )}
        </div>
        <button
          onClick={handleStopTool}
          className="px-4 py-2 bg-bad text-bad-ink hover:brightness-110 rounded-lg font-semibold transition-all"
        >
          Stop
        </button>
      </div>
    );
  const canStart = isConnected && !toolStatus.active;
  const startButton = (enabled: boolean, color: string) =>
    enabled ? color : 'bg-surface2 text-muted cursor-not-allowed';

  return (
    <div>
      <h2 className="text-[30px] font-bold text-accent mb-6">Tools</h2>

      {/* Countdown Section */}
      <div className={cardClass('countdown', 'border-info')}>
        <h3 className="text-xl font-semibold mb-4 text-info">Countdown Timer</h3>
        {runningBanner('countdown')}

        {/* Presets: start, edit and save in one place */}
        <div className="mb-6">
          <label className="block text-muted text-sm mb-3">Presets</label>
          <div className="space-y-3 mb-4">
            {presets.map((preset, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3 bg-page rounded-lg p-3">
                <input
                  type="text"
                  value={preset.name}
                  onChange={(e) => updatePreset(index, 'name', e.target.value)}
                  className="flex-1 min-w-[120px] px-3 py-2 bg-surface border border-line rounded-lg text-ink"
                  placeholder="Preset name"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={preset.minutes}
                    onChange={(e) => updatePreset(index, 'minutes', Math.min(99, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="w-20 px-3 py-2 bg-surface border border-line rounded-lg text-ink text-center"
                  />
                  <span className="text-muted">m</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={preset.seconds}
                    onChange={(e) => updatePreset(index, 'seconds', Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="w-20 px-3 py-2 bg-surface border border-line rounded-lg text-ink text-center"
                  />
                  <span className="text-muted">s</span>
                </div>
                <button
                  onClick={() => handleStartCountdown(preset.minutes, preset.seconds)}
                  disabled={!canStart}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-accent text-accent-ink hover:brightness-110')}`}
                >
                  Start
                </button>
                <button
                  onClick={() => removePreset(index)}
                  className="p-2 text-bad hover:text-bad transition-all"
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
              className="px-4 py-2 bg-accent text-accent-ink hover:brightness-110 rounded-lg font-semibold transition-all"
            >
              + Add Preset
            </button>
            <button
              onClick={handleSavePresets}
              className="px-4 py-2 bg-accent text-accent-ink hover:brightness-110 rounded-lg font-semibold transition-all"
            >
              Save Presets
            </button>
          </div>
        </div>

        {/* Custom Timer */}
        <div className="bg-page rounded-lg p-4 mb-4">
          <label className="block text-muted text-sm mb-3">Custom Timer</label>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-muted text-xs mb-1">Minutes</label>
              <input
                type="number"
                min="0"
                max="99"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Math.min(99, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink text-center"
              />
            </div>
            <div className="flex-1">
              <label className="block text-muted text-xs mb-1">Seconds</label>
              <input
                type="number"
                min="0"
                max="59"
                value={customSeconds}
                onChange={(e) => setCustomSeconds(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink text-center"
              />
            </div>
          </div>
          <button
            onClick={() => handleStartCountdown(customMinutes, customSeconds)}
            disabled={!canStart || (customMinutes === 0 && customSeconds === 0)}
            className={`w-full py-3 rounded-lg font-semibold transition-all ${startButton(canStart && (customMinutes > 0 || customSeconds > 0), 'bg-accent text-accent-ink hover:brightness-110')}`}
          >
            Start {customMinutes}m {customSeconds}s Countdown
          </button>
        </div>
      </div>

      {/* Scoreboard */}
      <div className={cardClass('scoreboard', 'border-bad')}>
        <h3 className="text-xl font-semibold mb-4 text-bad">Scoreboard</h3>
        {runningBanner('scoreboard')}
        <p className="text-muted text-sm mb-4">
          Display a scoreboard with Red vs Blue scores. Click "Start Scoreboard" to activate, then use +/- or type a score to update it. Use Stop above to end it.
        </p>

        {/* Score Controls */}
        <div className="grid grid-cols-2 gap-6 mb-4">
          {/* Red Team */}
          <div className="bg-page rounded-lg p-4">
            <label className="block text-bad text-sm mb-2 font-semibold"><MdCircle className="inline h-3 w-3 mr-1 align-baseline" aria-hidden />Red Team</label>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => updateScore('red', -1)}
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink text-ink text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Red score"
                value={scoreText.red ?? String(redScore)}
                onChange={(e) => typeScore('red', e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => setScoreText(prev => ({ ...prev, red: null }))}
                disabled={!isConnected}
                className="w-20 h-16 text-center bg-surface rounded-2xl border border-line shadow-card text-3xl font-bold text-bad focus:outline-none focus:ring-2 focus:ring-bad disabled:opacity-50"
              />
              <button
                onClick={() => updateScore('red', 1)}
                disabled={!isConnected}
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
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink text-ink text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Blue score"
                value={scoreText.blue ?? String(blueScore)}
                onChange={(e) => typeScore('blue', e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => setScoreText(prev => ({ ...prev, blue: null }))}
                disabled={!isConnected}
                className="w-20 h-16 text-center bg-surface rounded-2xl border border-line shadow-card text-3xl font-bold text-info focus:outline-none focus:ring-2 focus:ring-info disabled:opacity-50"
              />
              <button
                onClick={() => updateScore('blue', 1)}
                disabled={!isConnected}
                className="w-12 h-12 rounded-lg bg-info text-info-ink hover:brightness-110 text-2xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
              className={`flex-1 py-3 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-bad text-bad-ink hover:brightness-110')}`}
            >
              <MdEmojiEvents className="inline h-5 w-5 mr-1 align-text-bottom" aria-hidden />Start Scoreboard
            </button>
          )}
          <button
            onClick={() => updateScore('reset', 0)}
            disabled={!isConnected}
            className={`px-4 py-3 rounded-lg font-semibold transition-all ${startButton(isConnected, 'bg-line hover:bg-surface2')}`}
          >
            Reset
          </button>
        </div>

      </div>

      {/* Sound Detector */}
      <div className={cardClass('sound_detector', 'border-good')}>
        <h3 className="text-xl font-semibold mb-4 text-good">Sound Detector</h3>
        {runningBanner('sound_detector')}
        <p className="text-muted text-sm mb-4">
          Display a real-time noise meter on the Pixoo. Runs for 5 minutes or until stopped.
        </p>
        <button
          onClick={handleSoundDetector}
          disabled={!canStart}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${startButton(canStart, 'bg-accent text-accent-ink hover:brightness-110')}`}
        >
          <MdMic className="inline h-5 w-5 mr-1 align-text-bottom" aria-hidden />Start Sound Detector (5 min)
        </button>
      </div>
    </div>
  );
}
