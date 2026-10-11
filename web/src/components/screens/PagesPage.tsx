"use client";

import { apiFetch } from '@/ui/api';
import { AuthImage } from './AuthImage';
import { useState, useEffect, type ChangeEvent, type FocusEvent } from 'react';
import type { Config, CustomPage, ScriptInput, Pixel } from '@/ui/types';
import { API_URL, typeLabels } from '@/ui/types';
import { BeszelLogin } from './BeszelLogin';
import { DivoomPageFields } from './DivoomPageFields';
import {
  parseDuration,
  buildDivoomPayload,
  defaultDivoomData,
  divoomTypeLabels,
  DIVOOM_TYPES,
  isDivoomType,
  loadDivoomData,
  type DivoomData,
} from '@/ui/divoomPage';

interface PagesPageProps {
  config: Config | null;
  onConfigUpdate: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export function PagesPage({ config, onConfigUpdate, onNotify }: PagesPageProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [globalRefresh, setGlobalRefresh] = useState(config?.refresh_interval_ms || 1000);
  const [globalRotation, setGlobalRotation] = useState(config?.rotation_time_secs || 5);
  const [globalRefreshStr, setGlobalRefreshStr] = useState(String(config?.refresh_interval_ms || 1000));
  const [globalRotationStr, setGlobalRotationStr] = useState(String(config?.rotation_time_secs || 5));
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Page editor state
  const [pageName, setPageName] = useState('');
  const [pageType, setPageType] = useState('ClockWeather');
  const [pageEnabled, setPageEnabled] = useState(true);
  const [pageDurationStr, setPageDurationStr] = useState('');
  const [divoomData, setDivoomData] = useState<DivoomData>({});
  
  // Page type specific state
  const [clockColor, setClockColor] = useState('#00FFFF');
  const [dateColor, setDateColor] = useState('#FFFF00');
  const [weatherColor, setWeatherColor] = useState('#FFA500');
  const [weatherLocation, setWeatherLocation] = useState('');
  const [temperatureUnit, setTemperatureUnit] = useState('fahrenheit');
  
  // SystemStats - supports both Dashdot and Beszel
  const [statsSource, setStatsSource] = useState('dashdot');
  const [dashdotUrl, setDashdotUrl] = useState('http://localhost:3001');
  const [beszelHubUrl, setBeszelHubUrl] = useState('http://localhost:8090');
  const [beszelSystemId, setBeszelSystemId] = useState('');
  const [brandText, setBrandText] = useState('');
  const [brandColor, setBrandColor] = useState('#FFFFFF');
  
  // Temperature display options
  const [showCpuTemp, setShowCpuTemp] = useState(true);
  const [showGpuTemp, setShowGpuTemp] = useState(false);
  const [showStorageTemp, setShowStorageTemp] = useState(false);
  
  const [scriptPath, setScriptPath] = useState('');
  const [scriptInterval, setScriptInterval] = useState(1000);
  const [scriptIntervalStr, setScriptIntervalStr] = useState('1000');
  const [scriptInputs, setScriptInputs] = useState<ScriptInput[]>([]);
  
  const [imageMode, setImageMode] = useState('static');
  const [frameDuration, setFrameDuration] = useState(500);
  const [frameDurationStr, setFrameDurationStr] = useState('500');
  const [imageFilePath, setImageFilePath] = useState('');
  const [imageFileName, setImageFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const [pixelDrawColor, setPixelDrawColor] = useState('#00ffff');
  const [pixelGrid, setPixelGrid] = useState<(string | null)[]>(Array(256).fill(null));
  
  const [customText, setCustomText] = useState('');
  const [textYPosition, setTextYPosition] = useState(7);
  const [textYPositionStr, setTextYPositionStr] = useState('7');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [textBackgroundColor, setTextBackgroundColor] = useState('#000000');
  const [textScrollEnabled, setTextScrollEnabled] = useState(false);
  const [textScrollSpeed, setTextScrollSpeed] = useState(500);
  const [textScrollSpeedStr, setTextScrollSpeedStr] = useState('500');

  // Initialize from config only once on mount
  useEffect(() => {
    if (config) {
      const refresh = config.refresh_interval_ms || 1000;
      const rotation = config.rotation_time_secs || 5;
      setGlobalRefresh(refresh);
      setGlobalRotation(rotation);
      setGlobalRefreshStr(String(refresh));
      setGlobalRotationStr(String(rotation));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  const openEditor = (index: number = -1) => {
    setEditingIndex(index);
    if (index >= 0 && config) {
      const page = config.custom_pages[index];
      setPageName(page.name);
      setPageType(page.page_type.type || 'ClockWeather');
      setPageEnabled(page.enabled);
      setPageDurationStr(page.duration_secs ? String(page.duration_secs) : '');
      
      const data = page.page_type;
      if (isDivoomType(data.type)) setDivoomData(loadDivoomData(data.type, data));
      setClockColor('#' + (data.clock_color || '00FFFF'));
      setDateColor('#' + (data.date_color || 'FFFF00'));
      setWeatherColor('#' + (data.weather_color || 'FFA500'));
      setWeatherLocation(data.weather_location || config.weather_location || '');
      setTemperatureUnit(data.temperature_unit || 'fahrenheit');
      
      // SystemStats - supports both Dashdot and Beszel
      setStatsSource(data.source || 'dashdot');
      setDashdotUrl(data.dashdot_url || 'http://localhost:3001');
      setBeszelHubUrl(data.beszel_hub_url || 'http://localhost:8090');
      setBeszelSystemId(data.beszel_system_id || '');
      setBrandText(data.brand_text || '');
      setBrandColor('#' + (data.brand_color || 'FFFFFF'));

      // GpuStats - supports both Dashdot and Beszel
      if (page.page_type.type === 'GpuStats') {
        setStatsSource(data.source || 'dashdot');
        setDashdotUrl(data.dashdot_url || 'http://localhost:3001');
        setBeszelHubUrl(data.beszel_hub_url || 'http://localhost:8090');
        setBeszelSystemId(data.beszel_system_id || '');
        setBrandText(data.brand_text || '');
        setBrandColor('#' + (data.brand_color || 'FFFFFF'));
      }

      // Temps - supports both Dashdot and Beszel
      if (page.page_type.type === 'Temps') {
        setStatsSource(data.source || 'dashdot');
        setDashdotUrl(data.dashdot_url || 'http://localhost:3001');
        setBeszelHubUrl(data.beszel_hub_url || 'http://localhost:8090');
        setBeszelSystemId(data.beszel_system_id || '');
        setBrandText(data.brand_text || '');
        setBrandColor('#' + (data.brand_color || 'FFFFFF'));
        setShowCpuTemp(data.show_cpu !== false);  // Default true
        setShowGpuTemp(data.show_gpu || false);
        setShowStorageTemp(data.show_storage || false);
      }
      
      setScriptPath(data.script_path || '');
      const interval = data.interval || 1000;
      setScriptInterval(interval);
      setScriptIntervalStr(String(interval));
      setScriptInputs(data.inputs || []);
      
      setImageMode(data.mode || 'static');
      const duration = data.frame_duration ?? 100;
      setFrameDuration(duration);
      setFrameDurationStr(String(duration));
      setImageFilePath(data.file_path || '');
      setImageFileName(data.file_path ? data.file_path.split('_').slice(1).join('_') : '');

      const newGrid = Array(256).fill(null);
      (data.pixels || []).forEach((p: Pixel) => {
        if (p.x < 16 && p.y < 16) newGrid[p.y * 16 + p.x] = p.color;
      });
      setPixelGrid(newGrid);
      
      setCustomText(data.text || '');
      const yPos = data.y || 7;
      setTextYPosition(yPos);
      setTextYPositionStr(String(yPos));
      setTextColor('#' + (data.color || 'FFFFFF'));
      setTextBackgroundColor('#' + (data.background_color || '000000'));
      setTextScrollEnabled(data.enable_scroll || false);
      const scrollSpeed = data.scroll_speed || 500;
      setTextScrollSpeed(scrollSpeed);
      setTextScrollSpeedStr(String(scrollSpeed));
    } else {
      setPageName('New Page');
      setPageType('ClockWeather');
      setPageEnabled(true);
      setPageDurationStr('');
      resetToDefaults();
    }
    setShowEditor(true);
  };

  const resetToDefaults = () => {
    setClockColor('#00FFFF');
    setDateColor('#FFFF00');
    setWeatherColor('#FFA500');
    setWeatherLocation(config?.weather_location || '');
    setTemperatureUnit('fahrenheit');
    // SystemStats defaults
    setStatsSource('dashdot');
    setDashdotUrl('http://localhost:3001');
    setBeszelHubUrl('http://localhost:8090');
    setBeszelSystemId('');
    setBrandText('');
    setBrandColor('#FFFFFF');
    // Temps display defaults
    setShowCpuTemp(true);
    setShowGpuTemp(false);
    setShowStorageTemp(false);
    setScriptPath('');
    setScriptInterval(1000);
    setScriptInputs([]);
    setImageMode('static');
    setFrameDuration(100);
    setFrameDurationStr('100');
    setImageFilePath('');
    setImageFileName('');
    setPixelGrid(Array(256).fill(null));
    setCustomText('');
    setTextYPosition(7);
    setTextColor('#FFFFFF');
    setTextBackgroundColor('#000000');
    setTextScrollEnabled(false);
    setTextScrollSpeed(500);
  };

  const handleSavePage = async () => {
    if (!config) return;
    
    let pageTypeData = { type: pageType } as unknown as CustomPage['page_type'];
    
    if (isDivoomType(pageType)) {
      pageTypeData = buildDivoomPayload(pageType, divoomData) as unknown as CustomPage['page_type'];
    } else if (pageType === 'ClockWeather') {
      Object.assign(pageTypeData, {
        clock_color: clockColor.substring(1),
        date_color: dateColor.substring(1),
        weather_color: weatherColor.substring(1),
        weather_location: weatherLocation,
        temperature_unit: temperatureUnit
      });
    } else if (pageType === 'SystemStats') {
      Object.assign(pageTypeData, {
        source: statsSource,
        dashdot_url: statsSource === 'dashdot' ? dashdotUrl : undefined,
        beszel_hub_url: statsSource === 'beszel' ? beszelHubUrl : undefined,
        beszel_system_id: statsSource === 'beszel' ? beszelSystemId || undefined : undefined,
        brand_text: brandText,
        brand_color: brandColor.substring(1)
      });
    } else if (pageType === 'GpuStats') {
      Object.assign(pageTypeData, {
        source: statsSource,
        dashdot_url: statsSource === 'dashdot' ? dashdotUrl : undefined,
        beszel_hub_url: statsSource === 'beszel' ? beszelHubUrl : undefined,
        beszel_system_id: statsSource === 'beszel' ? beszelSystemId || undefined : undefined,
        brand_text: brandText,
        brand_color: brandColor.substring(1)
      });
    } else if (pageType === 'Temps') {
      Object.assign(pageTypeData, {
        source: statsSource,
        dashdot_url: statsSource === 'dashdot' ? dashdotUrl : undefined,
        beszel_hub_url: statsSource === 'beszel' ? beszelHubUrl : undefined,
        beszel_system_id: statsSource === 'beszel' ? beszelSystemId || undefined : undefined,
        brand_text: brandText,
        brand_color: brandColor.substring(1),
        show_cpu: showCpuTemp,
        show_gpu: showGpuTemp,
        show_storage: showStorageTemp
      });
    } else if (pageType === 'CustomScript') {
      Object.assign(pageTypeData, {
        script_path: scriptPath,
        interval: scriptInterval,
        inputs: scriptInputs
      });
    } else if (pageType === 'ImageUpload') {
      Object.assign(pageTypeData, {
        mode: imageMode,
        frame_duration: frameDuration,
        file_path: imageFilePath || undefined
      });
    } else if (pageType === 'CustomPixels') {
      const pixels: Pixel[] = [];
      pixelGrid.forEach((color, i) => {
        if (color) pixels.push({ x: i % 16, y: Math.floor(i / 16), color });
      });
      Object.assign(pageTypeData, { pixels });
    } else if (pageType === 'CustomText') {
      Object.assign(pageTypeData, {
        text: customText,
        y: textYPosition,
        color: textColor.substring(1),
        background_color: textBackgroundColor.substring(1),
        enable_scroll: textScrollEnabled,
        scroll_speed: textScrollSpeed
      });
    }
    
    const newPage: CustomPage = { 
      name: pageName, 
      enabled: pageEnabled, 
      page_type: pageTypeData,
      duration_secs: parseDuration(pageDurationStr)
    };
    const newPages = [...(config.custom_pages || [])];
    
    if (editingIndex >= 0) {
      newPages[editingIndex] = newPage;
    } else {
      newPages.push(newPage);
    }
    
    const newConfig = { 
      ...config, 
      custom_pages: newPages,
      refresh_interval_ms: globalRefresh,
      rotation_time_secs: globalRotation
    };
    
    try {
      const response = await apiFetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const result = await response.json();
      
      if (result.success) {
        onNotify('Page saved!');
        setShowEditor(false);
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed', 'error');
      }
    } catch (error) {
      onNotify('Save failed', 'error');
    }
  };

  const handleDeletePage = async () => {
    if (!config || editingIndex < 0) return;
    if (!confirm('Delete this page?')) return;
    
    const newPages = config.custom_pages.filter((_, i) => i !== editingIndex);
    const newConfig = { 
      ...config, 
      custom_pages: newPages,
      refresh_interval_ms: globalRefresh,
      rotation_time_secs: globalRotation
    };
    
    try {
      const response = await apiFetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const result = await response.json();
      
      if (result.success) {
        onNotify('Page deleted');
        setShowEditor(false);
        onConfigUpdate();
      }
    } catch (error) {
      onNotify('Delete failed', 'error');
    }
  };

  const handleTogglePageEnabled = async (index: number) => {
    if (!config) return;

    const newPages = [...config.custom_pages];
    newPages[index] = { ...newPages[index], enabled: !newPages[index].enabled };
    const newConfig = {
      ...config,
      custom_pages: newPages,
      refresh_interval_ms: globalRefresh,
      rotation_time_secs: globalRotation
    };

    try {
      const response = await apiFetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const result = await response.json();

      if (result.success) {
        onNotify(newPages[index].enabled ? 'Page enabled' : 'Page disabled');
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to toggle page', 'error');
      }
    } catch (error) {
      onNotify('Toggle failed', 'error');
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Set a transparent drag image or use default
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggingIndex !== null && draggingIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === dropIndex || !config) {
      setDraggingIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newPages = [...config.custom_pages];
    const [movedPage] = newPages.splice(draggingIndex, 1);
    newPages.splice(dropIndex, 0, movedPage);

    const newConfig = {
      ...config,
      custom_pages: newPages,
      refresh_interval_ms: globalRefresh,
      rotation_time_secs: globalRotation
    };

    try {
      const response = await apiFetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Page order updated');
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to reorder pages', 'error');
      }
    } catch (error) {
      onNotify('Reorder failed', 'error');
    }

    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const handleSaveGlobalSettings = async () => {
    if (!config) return;

    const newConfig = {
      ...config,
      refresh_interval_ms: globalRefresh,
      rotation_time_secs: globalRotation
    };

    try {
      const response = await apiFetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const result = await response.json();

      if (result.success) {
        onNotify('Global settings saved!');
        onConfigUpdate();
      } else {
        onNotify(result.error || 'Failed to save settings', 'error');
      }
    } catch (error) {
      onNotify('Save failed', 'error');
    }
  };

  const addScriptInput = () => {
    setScriptInputs([...scriptInputs, { name: '', label: '', input_type: 'text', default_value: '' }]);
  };

  const removeScriptInput = (idx: number) => {
    setScriptInputs(scriptInputs.filter((_, i) => i !== idx));
  };

  const updateScriptInput = (idx: number, field: keyof ScriptInput, value: string) => {
    const newInputs = [...scriptInputs];
    newInputs[idx] = { ...newInputs[idx], [field]: value };
    setScriptInputs(newInputs);
  };

  const handlePixelClick = (index: number) => {
    const newGrid = [...pixelGrid];
    if (newGrid[index]) {
      newGrid[index] = null;
    } else {
      newGrid[index] = pixelDrawColor.substring(1);
    }
    setPixelGrid(newGrid);
  };

  const handlePixelRightClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    const newGrid = [...pixelGrid];
    newGrid[index] = null;
    setPixelGrid(newGrid);
  };

  const clearPixelGrid = () => {
    setPixelGrid(Array(256).fill(null));
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await apiFetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        setImageFilePath(result.filename);
        setImageFileName(result.original_name);
        onNotify(`Uploaded: ${result.original_name}`, 'success');
      } else {
        onNotify(result.error || 'Upload failed', 'error');
      }
    } catch (error) {
      onNotify('Upload failed', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    setImageFilePath('');
    setImageFileName('');
  };

  return (
    <div className="max-w-[900px]">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <h2 className="text-2xl sm:text-[30px] font-bold text-cyan-400">Pages</h2>
        <button className="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-green-700" onClick={() => openEditor()}>+ Add Page</button>
      </div>

      <BeszelLogin config={config} onConfigUpdate={onConfigUpdate} onNotify={onNotify} />

      <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Global Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Refresh Interval (ms)</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={globalRefreshStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const val = e.target.value;
                if (val === '' || /^\d+$/.test(val)) {
                  setGlobalRefreshStr(val);
                  const num = parseInt(val) || 1000;
                  setGlobalRefresh(Math.min(5000, Math.max(50, num)));
                }
              }}
              onBlur={(e: FocusEvent<HTMLInputElement>) => {
                const num = parseInt(e.target.value) || 1000;
                const clamped = Math.min(5000, Math.max(50, num));
                setGlobalRefresh(clamped);
                setGlobalRefreshStr(String(clamped));
              }}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Rotation Time (seconds per page)</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={globalRotationStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const val = e.target.value;
                if (val === '' || /^\d+$/.test(val)) {
                  setGlobalRotationStr(val);
                  const num = parseInt(val) || 5;
                  setGlobalRotation(Math.min(300, Math.max(1, num)));
                }
              }}
              onBlur={(e: FocusEvent<HTMLInputElement>) => {
                const num = parseInt(e.target.value) || 5;
                const clamped = Math.min(300, Math.max(1, num));
                setGlobalRotation(clamped);
                setGlobalRotationStr(String(clamped));
              }}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSaveGlobalSettings}
            className="px-6 py-2 bg-cyan-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-cyan-700"
          >
            Save Settings
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
        {config?.custom_pages?.length === 0 ? (
          <div className="col-span-full text-center text-gray-500 py-12">No pages yet. Click "Add Page" to create one.</div>
        ) : (
          config?.custom_pages?.map((page, idx) => (
            <div
              key={idx}
              draggable={!showEditor}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`
                ${page.enabled ? 'bg-gray-800 rounded-lg p-4 border-2 transition-all border-cyan-600' : 'bg-gray-800 rounded-lg p-4 border-2 transition-all border-gray-600 opacity-50'}
                ${draggingIndex === idx ? 'opacity-30 cursor-grabbing' : 'cursor-grab'}
                ${dragOverIndex === idx && draggingIndex !== idx ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-900 scale-105' : 'hover:-translate-y-0.5 hover:shadow-lg'}
              `}
            >
              <div className="flex justify-between items-start mb-3 gap-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                  <h4 className="font-semibold text-base truncate">{page.name}</h4>
                </div>
                <span className="text-xs px-2 py-1 bg-gray-700 rounded flex-shrink-0">{typeLabels[page.page_type.type] || page.page_type.type}</span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  id={`enabled-${idx}`}
                  checked={page.enabled}
                  onChange={() => handleTogglePageEnabled(idx)}
                  className="w-4 h-4"
                />
                <label htmlFor={`enabled-${idx}`} className="text-gray-400 text-sm cursor-pointer">
                  {page.enabled ? 'Enabled' : 'Disabled'}
                </label>
              </div>
              <button className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-cyan-700 w-full" onClick={() => openEditor(idx)}>Edit</button>
            </div>
          ))
        )}
      </div>

      {/* Page Editor Modal */}
      {showEditor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowEditor(false); }}>
          <div className="bg-gray-800 rounded-none sm:rounded-xl w-full max-w-[700px] max-h-[100vh] sm:max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 sm:p-6 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-xl sm:text-2xl font-bold text-cyan-400">{editingIndex >= 0 ? 'Edit Page' : 'New Page'}</h3>
              <button className="bg-none border-none text-gray-400 text-2xl cursor-pointer hover:text-white" onClick={() => setShowEditor(false)}>&times;</button>
            </div>
            
            <div className="p-4 sm:p-6">
              <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">Page Name</label>
                <input type="text" value={pageName} onChange={(e) => setPageName(e.target.value)} className="w-full px-3 sm:px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400" />
              </div>
              
              <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">Page Type</label>
                <select value={pageType} onChange={(e) => {
                  setPageType(e.target.value);
                  if (isDivoomType(e.target.value)) setDivoomData(defaultDivoomData(e.target.value));
                }} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400">
                  <option value="ClockWeather">Clock & Weather</option>
                  <option value="CustomScript">Custom Script</option>
                  <option value="CustomText">Custom Text</option>
                  <option value="GpuStats">GPU Stats</option>
                  <option value="ImageUpload">Image / GIF</option>
                  <option value="CustomPixels">Pixel Drawing</option>
                  <option value="SystemStats">System Stats (Dashdot/Beszel)</option>
                  <option value="Temps">Temps (CPU)</option>
                  <optgroup label="Divoom native (device-rendered)">
                    {DIVOOM_TYPES.map((t) => <option key={t} value={t}>{divoomTypeLabels[t]}</option>)}
                  </optgroup>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">Display time (seconds)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageDurationStr}
                  onChange={(e) => setPageDurationStr(e.target.value.replace(/\D/g, ''))}
                  placeholder={`Default (${globalRotation}s)`}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
                />
                <p className="text-gray-500 text-xs mt-1">
                  Leave empty to use the global rotation time. Set a longer time for pages the device animates itself, such as User GIFs with many GIFs.
                </p>
              </div>

              {isDivoomType(pageType) && (
                <DivoomPageFields type={pageType} data={divoomData} onChange={setDivoomData} />
              )}
              
              {/* Clock/Weather Options */}
              {pageType === 'ClockWeather' && (
                <div className="mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Clock Color</label>
                      <input type="color" value={clockColor} onChange={(e) => setClockColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                    </div>
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Date Color</label>
                      <input type="color" value={dateColor} onChange={(e) => setDateColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                    </div>
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Weather Color</label>
                      <input type="color" value={weatherColor} onChange={(e) => setWeatherColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Weather Location</label>
                    <input type="text" value={weatherLocation} onChange={(e) => setWeatherLocation(e.target.value)} placeholder="New York,NY" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400" />
                    <p className="text-gray-500 text-sm mt-2">Sent to your weather URL as {"{location}"} and {"{unit}"} (PXLS_WEATHER_URL). Without that URL no weather is shown.</p>
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Temperature Unit</label>
                    <select value={temperatureUnit} onChange={(e) => setTemperatureUnit(e.target.value)} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400">
                      <option value="celsius">Celsius (°C)</option>
                      <option value="fahrenheit">Fahrenheit (°F)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* System Stats Options */}
              {pageType === 'SystemStats' && (
                <div className="mt-4">
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Source</label>
                    <select value={statsSource} onChange={(e) => setStatsSource(e.target.value)} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400">
                      <option value="beszel">Beszel</option>
                      <option value="dashdot">Dashdot</option>
                    </select>
                  </div>
                  
                  {statsSource === 'dashdot' && (
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Dashdot URL</label>
                      <input type="text" value={dashdotUrl} onChange={(e) => setDashdotUrl(e.target.value)} placeholder="http://dashdot.local:3001" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      <p className="text-gray-500 text-xs mt-1">Local: http://localhost:3001 | Remote: http://ip:3001</p>
                    </div>
                  )}
                  
                  {statsSource === 'beszel' && (
                    <>
                      <div className="mb-4">
                        <label className="block text-gray-400 text-sm mb-2">Beszel Hub URL</label>
                        <input type="text" value={beszelHubUrl} onChange={(e) => setBeszelHubUrl(e.target.value)} placeholder="http://localhost:8090" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      </div>
                      <div className="mb-4">
                        <label className="block text-gray-400 text-sm mb-2">System ID (optional)</label>
                        <input type="text" value={beszelSystemId} onChange={(e) => setBeszelSystemId(e.target.value)} placeholder="Leave empty for auto-select" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      </div>
                      <div className="mb-4">
                        <p className="text-gray-400 text-sm">Uses global authentication token configured above.</p>
                      </div>
                    </>
                  )}
                  <div className="mb-4 bg-gray-900 p-3 rounded-lg">
                    <label className="block text-gray-400 text-sm mb-2">Color Thresholds</label>
                    <div className="flex gap-2 text-xs">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#00ff00'}}></span>0-50% Good</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ffff00'}}></span>50-75% Okay</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ffa500'}}></span>75-90% Concern</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ff0000'}}></span>90%+ Critical</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-2">Offline/unreachable shows "--" in gray</p>
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Brand Text</label>
                    <input type="text" value={brandText} onChange={(e) => setBrandText(e.target.value.toUpperCase())} maxLength={5} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 uppercase" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Brand Color</label>
                    <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                  </div>
                </div>
              )}

              {/* GPU Stats Options */}
              {pageType === 'GpuStats' && (
                <div className="mt-4">
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Source</label>
                    <select value={statsSource} onChange={(e) => setStatsSource(e.target.value)} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400">
                      <option value="beszel">Beszel</option>
                      <option value="dashdot">Dashdot</option>
                    </select>
                  </div>
                  
                  {statsSource === 'dashdot' && (
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Dashdot URL</label>
                      <input type="text" value={dashdotUrl} onChange={(e) => setDashdotUrl(e.target.value)} placeholder="http://localhost:3001" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      <p className="text-gray-500 text-xs mt-1">Local: http://localhost:3001 | Remote: http://ip:3001</p>
                    </div>
                  )}
                  
                  {statsSource === 'beszel' && (
                    <>
                      <div className="mb-4">
                        <label className="block text-gray-400 text-sm mb-2">Beszel Hub URL</label>
                        <input type="text" value={beszelHubUrl} onChange={(e) => setBeszelHubUrl(e.target.value)} placeholder="http://localhost:8090" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      </div>
                      <div className="mb-4">
                        <label className="block text-gray-400 text-sm mb-2">System ID (optional)</label>
                        <input type="text" value={beszelSystemId} onChange={(e) => setBeszelSystemId(e.target.value)} placeholder="Leave empty for auto-select" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      </div>
                      <div className="mb-4">
                        <p className="text-gray-400 text-sm">Uses global authentication token configured above.</p>
                      </div>
                    </>
                  )}
                  <div className="mb-4 bg-gray-900 p-3 rounded-lg">
                    <label className="block text-gray-400 text-sm mb-2">Color Thresholds</label>
                    <div className="flex gap-2 text-xs">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#00ff00'}}></span>0-50% Good</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ffff00'}}></span>50-75% Okay</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ffa500'}}></span>75-90% Concern</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ff0000'}}></span>90%+ Critical</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-2">Displays: L=Load%, M=Memory%</p>
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Brand Text</label>
                    <input type="text" value={brandText} onChange={(e) => setBrandText(e.target.value.toUpperCase())} maxLength={5} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 uppercase" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Brand Color</label>
                    <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                  </div>
                </div>
              )}

              {/* Temps Options */}
              {pageType === 'Temps' && (
                <div className="mt-4">
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Source</label>
                    <select value={statsSource} onChange={(e) => setStatsSource(e.target.value)} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400">
                      <option value="beszel">Beszel</option>
                      <option value="dashdot">Dashdot</option>
                    </select>
                  </div>
                  
                  {statsSource === 'dashdot' && (
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Dashdot URL</label>
                      <input type="text" value={dashdotUrl} onChange={(e) => setDashdotUrl(e.target.value)} placeholder="http://localhost:3001" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      <p className="text-gray-500 text-xs mt-1">Local: http://localhost:3001 | Remote: http://ip:3001</p>
                    </div>
                  )}
                  
                  {statsSource === 'beszel' && (
                    <>
                      <div className="mb-4">
                        <label className="block text-gray-400 text-sm mb-2">Beszel Hub URL</label>
                        <input type="text" value={beszelHubUrl} onChange={(e) => setBeszelHubUrl(e.target.value)} placeholder="http://localhost:8090" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      </div>
                      <div className="mb-4">
                        <label className="block text-gray-400 text-sm mb-2">System ID (optional)</label>
                        <input type="text" value={beszelSystemId} onChange={(e) => setBeszelSystemId(e.target.value)} placeholder="Leave empty for auto-select" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                      </div>
                      <div className="mb-4">
                        <p className="text-gray-400 text-sm">Uses global authentication token configured above.</p>
                      </div>
                    </>
                  )}
                  <div className="mb-4 bg-gray-800 p-3 rounded-lg">
                    <label className="block text-gray-400 text-sm mb-3">Display Options (Max 2)</label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={showCpuTemp} onChange={(e) => setShowCpuTemp(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500" />
                        <span className="text-white text-sm">CPU Temperature</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={showGpuTemp} onChange={(e) => setShowGpuTemp(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500" />
                        <span className="text-white text-sm">GPU Temperature (Beszel only)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={showStorageTemp} onChange={(e) => setShowStorageTemp(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500" />
                        <span className="text-white text-sm">Storage Temperature (Beszel only)</span>
                      </label>
                    </div>
                    <p className="text-gray-500 text-xs mt-2">Select up to 2 temperatures to display (16x16 pixel limit)</p>
                  </div>
                  
                  <div className="mb-4 bg-gray-900 p-3 rounded-lg">
                    <label className="block text-gray-400 text-sm mb-2">Temp Color Thresholds</label>
                    <div className="flex gap-2 text-xs">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#00ff00'}}></span>0-50°C Good</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ffff00'}}></span>50-70°C Warm</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ffa500'}}></span>70-85°C Hot</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{backgroundColor: '#ff0000'}}></span>85°C+ Critical</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-2">Displays: CPU temperature (integrated GPU shares same thermals)</p>
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Brand Text</label>
                    <input type="text" value={brandText} onChange={(e) => setBrandText(e.target.value.toUpperCase())} maxLength={5} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 uppercase" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Brand Color</label>
                    <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                  </div>
                </div>
              )}

              {/* Custom Script Options */}
              {pageType === 'CustomScript' && (
                <div className="mt-4">
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Script Path</label>
                    <input type="text" value={scriptPath} onChange={(e) => setScriptPath(e.target.value)} placeholder="/path/to/script.sh" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 font-mono" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Execution Interval (ms)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={scriptIntervalStr}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const val = e.target.value;
                        if (val === '' || /^\d+$/.test(val)) {
                          setScriptIntervalStr(val);
                          const num = parseInt(val) || 1000;
                          setScriptInterval(Math.min(60000, Math.max(100, num)));
                        }
                      }}
                      onBlur={(e: FocusEvent<HTMLInputElement>) => {
                        const num = parseInt(e.target.value) || 1000;
                        const clamped = Math.min(60000, Math.max(100, num));
                        setScriptInterval(clamped);
                        setScriptIntervalStr(String(clamped));
                      }}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Script Inputs</label>
                    <div className="flex flex-col gap-2 mb-3">
                      {scriptInputs.map((input, idx) => (
                        <div key={idx} className="flex gap-2 items-center bg-gray-900 p-2 rounded">
                          <input type="text" placeholder="Name" value={input.name} onChange={(e) => updateScriptInput(idx, 'name', e.target.value)} className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm flex-1" />
                          <input type="text" placeholder="Label" value={input.label} onChange={(e) => updateScriptInput(idx, 'label', e.target.value)} className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm flex-1" />
                          <select value={input.input_type} onChange={(e) => updateScriptInput(idx, 'input_type', e.target.value)} className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm">
                            <option value="boolean">boolean</option>
                            <option value="color">color</option>
                            <option value="number">number</option>
                            <option value="text">text</option>
                          </select>
                          <input type="text" placeholder="Default" value={input.default_value} onChange={(e) => updateScriptInput(idx, 'default_value', e.target.value)} className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm w-20 flex-none" />
                          <button className="bg-none border-none text-red-400 text-xl cursor-pointer px-2 hover:text-red-500" onClick={() => removeScriptInput(idx)}>×</button>
                        </div>
                      ))}
                    </div>
                    <button className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-all hover:bg-cyan-700" onClick={addScriptInput}>+ Add Input</button>
                  </div>
                </div>
              )}

              {/* Image Upload Options */}
              {pageType === 'ImageUpload' && (
                <div className="mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Display Mode</label>
                      <div className="h-4"></div>
                      <select value={imageMode} onChange={(e) => setImageMode(e.target.value)} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400">
                        <option value="animated">Animated (GIF)</option>
                        <option value="scroll">Scroll</option>
                        <option value="static">Static</option>
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Frame Duration (ms)</label>
                      <p className="text-xs text-gray-500 mb-1">Set to 0 for native GIF timing</p>
                      <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={frameDurationStr}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const val = e.target.value;
                        if (val === '' || /^\d+$/.test(val)) {
                          setFrameDurationStr(val);
                          const num = parseInt(val) || 0;
                          setFrameDuration(Math.min(5000, Math.max(0, num)));
                        }
                      }}
                      onBlur={(e: FocusEvent<HTMLInputElement>) => {
                        const num = parseInt(e.target.value) || 0;
                        const clamped = Math.min(5000, Math.max(0, num));
                        setFrameDuration(clamped);
                        setFrameDurationStr(String(clamped));
                      }}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
                    />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Upload Image/GIF</label>
                    <div className="flex flex-col gap-3">
                      {imageFilePath ? (
                        <div className="bg-gray-900 p-3 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-green-400">Uploaded: {imageFileName}</span>
                            <button
                              onClick={handleRemoveImage}
                              className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                            >
                              Remove
                            </button>
                          </div>
                          <AuthImage
                            src={`${API_URL}/api/uploads/${imageFilePath}`}
                            alt="Preview"
                            className="w-16 h-16 object-cover rounded border border-gray-600"
                          />
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/gif,image/bmp,image/webp"
                            onChange={handleFileUpload}
                            disabled={isUploading}
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-700 file:cursor-pointer disabled:opacity-50"
                          />
                          {isUploading && (
                            <span className="text-sm text-cyan-400 mt-2 block">Uploading...</span>
                          )}
                        </div>
                      )}
                      <p className="text-gray-500 text-xs">Supported: PNG, JPG, JPEG, GIF, BMP, WEBP (max 5MB)</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Pixel Drawing Options */}
              {pageType === 'CustomPixels' && (
                <div className="mt-4">
                  <label className="block text-gray-400 text-sm mb-2">16x16 Pixel Grid</label>
                  <div className="flex gap-3 mb-3 items-center">
                    <input type="color" value={pixelDrawColor} onChange={(e: ChangeEvent<HTMLInputElement>) => setPixelDrawColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                    <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-all hover:bg-red-700" onClick={clearPixelGrid}>Clear</button>
                  </div>
                  <div className="flex justify-center">
                    <div className="grid grid-cols-16 gap-px bg-gray-700 p-1 rounded w-64 h-64">
                      {pixelGrid.map((color: string | null, i: number) => (
                        <div
                          key={i}
                          className={`bg-gray-900 rounded-sm cursor-pointer ${color ? 'shadow-[0_0_2px_currentColor]' : ''}`}
                          style={{ backgroundColor: color ? '#' + color : undefined }}
                          onClick={() => handlePixelClick(i)}
                          onContextMenu={(e) => handlePixelRightClick(e, i)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Custom Text Options */}
              {pageType === 'CustomText' && (
                <div className="mt-4">
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Text (supports multi-line)</label>
                    <textarea 
                      value={customText} 
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCustomText(e.target.value)} 
                      placeholder="Enter your text...\nNew line = new line" 
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400 resize-none h-24" 
                      rows={3}
                    />
                    <small className="text-gray-500 text-xs">Multi-line text supported. First line will scroll if longer than 5 characters.</small>
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">Y Position (0-15)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={textYPositionStr}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const val = e.target.value;
                        if (val === '' || /^\d+$/.test(val)) {
                          setTextYPositionStr(val);
                          const num = parseInt(val) || 7;
                          setTextYPosition(Math.min(15, Math.max(0, num)));
                        }
                      }}
                      onBlur={(e: FocusEvent<HTMLInputElement>) => {
                        const num = parseInt(e.target.value) || 7;
                        const clamped = Math.min(15, Math.max(0, num));
                        setTextYPosition(clamped);
                        setTextYPositionStr(String(clamped));
                      }}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Text Color</label>
                      <input type="color" value={textColor} onChange={(e: ChangeEvent<HTMLInputElement>) => setTextColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                    </div>
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Background Color</label>
                      <input type="color" value={textBackgroundColor} onChange={(e: ChangeEvent<HTMLInputElement>) => setTextBackgroundColor(e.target.value)} className="w-full h-11 border-none rounded-lg cursor-pointer bg-none" />
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="flex items-center gap-2 text-gray-400 text-sm">
                      <input 
                        type="checkbox" 
                        checked={textScrollEnabled} 
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTextScrollEnabled(e.target.checked)} 
                        className="w-4 h-4" 
                      />
                      Enable Scrolling
                    </label>
                  </div>
                  {textScrollEnabled && (
                    <div className="mb-4">
                      <label className="block text-gray-400 text-sm mb-2">Scroll Speed (ms per character)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={textScrollSpeedStr}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          const val = e.target.value;
                          if (val === '' || /^\d+$/.test(val)) {
                            setTextScrollSpeedStr(val);
                            const num = parseInt(val) || 500;
                            setTextScrollSpeed(Math.min(2000, Math.max(100, num)));
                          }
                        }}
                        onBlur={(e: FocusEvent<HTMLInputElement>) => {
                          const num = parseInt(e.target.value) || 500;
                          const clamped = Math.min(2000, Math.max(100, num));
                          setTextScrollSpeed(clamped);
                          setTextScrollSpeedStr(String(clamped));
                        }}
                        className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-4 sm:p-6 border-t border-gray-700 flex flex-col sm:flex-row gap-3">
              <button className="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-green-700" onClick={handleSavePage}>Save</button>
              {editingIndex >= 0 && <button className="w-full sm:w-auto px-6 py-3 bg-red-600 text-white rounded-lg text-base font-semibold cursor-pointer transition-all hover:bg-red-700" onClick={handleDeletePage}>Delete</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
