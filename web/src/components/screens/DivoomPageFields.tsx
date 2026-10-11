import type { DivoomData, DivoomPageType, Rgb } from '@/ui/divoomPage';
import { hexToRgb, rgbToHex } from '@/ui/divoomPage';

interface Props {
  type: DivoomPageType;
  data: DivoomData;
  onChange: (data: DivoomData) => void;
}

const inputClass =
  'w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-base focus:outline-none focus:border-cyan-400';

const CLOCK_DESIGNS = [
  ['digital', 'Digital'],
  ['digital_rainbow', 'Digital Rainbow'],
  ['digital_box', 'Digital Box'],
  ['digital_inverted', 'Digital Inverted'],
  ['analog1', 'Analog 1'],
  ['analog2', 'Analog 2'],
];
const LIGHT_EFFECTS = [
  [0, 'Normal'],
  [1, 'Rainbow'],
  [2, 'Plants'],
  [3, 'Fly'],
  [4, 'Sleep'],
] as const;
const SPECIAL_MODES = ['default', 'sparkle', 'breath', 'wave'];
const MUSIC_MODES = [
  'bottom_bars',
  'center_bars',
  'side_bars',
  'face1',
  'face2',
  'face3',
  'frog_face',
  'matrix',
  'falling_blocks',
  'fireworks',
  'dancing_boy',
  'dancing_girl',
];

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function DivoomPageFields({ type, data, onChange }: Props) {
  const set = (patch: DivoomData) => onChange({ ...data, ...patch });
  const num = (key: string) => String(data[key] ?? 0);
  const clamp = (v: string, max: number) => Math.min(max, Math.max(0, parseInt(v, 10) || 0));

  // A function, not an element: only Clock and Light have a colour, and building
  // this eagerly would read data.color for every type and throw.
  const colorField = () => (
    <div className="mb-4">
      <label className="block text-gray-400 text-sm mb-2">Color</label>
      <input
        type="color"
        value={rgbToHex(data.color as Rgb)}
        onChange={(e) => set({ color: hexToRgb(e.target.value) })}
        className="w-full h-11 border-none rounded-lg cursor-pointer bg-none"
      />
    </div>
  );

  return (
    <div className="mt-4">
      <p className="text-gray-400 text-sm mb-4">
        The device draws this page itself. It can't be previewed here, and the screen is switched
        to it when the rotation reaches it.
      </p>

      {type === 'DivoomEnvironment' && (
        <>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Clock Design</label>
            <select value={String(data.clock_design)} onChange={(e) => set({ clock_design: e.target.value })} className={inputClass}>
              {CLOCK_DESIGNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {(['show_divoom', 'show_weather', 'show_temp', 'show_date'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer text-white">
                <input type="checkbox" checked={Boolean(data[k])} onChange={(e) => set({ [k]: e.target.checked })} />
                {label(k.replace('show_', 'Show '))}
              </label>
            ))}
          </div>
          {colorField()}
        </>
      )}

      {type === 'DivoomLight' && (
        <>
          {colorField()}
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Brightness ({num('brightness')}%)</label>
            <input type="range" min={0} max={100} value={num('brightness')} onChange={(e) => set({ brightness: clamp(e.target.value, 100) })} className="w-full" />
          </div>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Effect</label>
            <select value={num('effect_mode')} onChange={(e) => set({ effect_mode: clamp(e.target.value, 4) })} className={inputClass}>
              {LIGHT_EFFECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-white mb-4">
            <input type="checkbox" checked={Boolean(data.on)} onChange={(e) => set({ on: e.target.checked })} />
            Light on
          </label>
        </>
      )}

      {type === 'DivoomSpecial' && (
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Effect</label>
          <select value={String(data.mode)} onChange={(e) => set({ mode: e.target.value })} className={inputClass}>
            {SPECIAL_MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </div>
      )}

      {type === 'DivoomMusic' && (
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Visualization</label>
          <select value={String(data.mode)} onChange={(e) => set({ mode: e.target.value })} className={inputClass}>
            {MUSIC_MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </div>
      )}

      {type === 'DivoomUser' && (
        <p className="text-gray-400 text-sm">
          Shows the GIFs you uploaded to the device through the Divoom app.
        </p>
      )}

      {type === 'DivoomScore' && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          {(['red_score', 'blue_score'] as const).map((k) => (
            <div key={k}>
              <label className="block text-gray-400 text-sm mb-2">{label(k)} (0-999)</label>
              <input type="number" min={0} max={999} value={num(k)} onChange={(e) => set({ [k]: clamp(e.target.value, 999) })} className={inputClass} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
