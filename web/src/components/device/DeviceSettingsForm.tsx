"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/app/actions/auth";
import { saveDevice } from "@/app/actions/device";
import { Alert } from "@/components/Alert";
import type { DeviceConfig } from "@/lib/config/model";

const MODES: [string, string, string][] = [
  ["custom", "Custom Pages", "pxls renders your pages and rotates through them."],
  ["env", "Environment Mode", "The device's own clock with optional weather, temperature and date."],
  ["light", "Light Mode", "Use the display as a lamp."],
  ["special", "Special Mode", "Special visual effects for the display."],
  ["music", "Music Mode", "Music visualization reacts to ambient sound."],
  ["user", "User Mode", "User mode uses custom GIFs uploaded to device through Divoom app."],
  ["score", "Score Mode", "Keep track of game scores."],
];

const CLOCKS = [
  ["digital", "Digital"], ["digital_rainbow", "Digital Rainbow"], ["digital_box", "Digital Box"],
  ["analog1", "Analog 1"], ["digital_inverted", "Digital Inverted"], ["analog2", "Analog 2"],
];
const EFFECTS = ["Normal", "Rainbow", "Plants", "Fly", "Sleep"];
const SPECIALS = [["default", "Default"], ["sparkle", "Sparkle"], ["breath", "Breath"], ["wave", "Wave"]];
const MUSIC = [
  ["bottom_bars", "Bottom Bars"], ["center_bars", "Center Bars"], ["side_bars", "Side Bars"], ["face1", "Face 1"],
  ["face2", "Face 2"], ["face3", "Face 3"], ["frog_face", "Frog Face"], ["matrix", "Matrix"],
  ["falling_blocks", "Falling Blocks"], ["fireworks", "Fireworks"], ["dancing_boy", "Dancing Boy"], ["dancing_girl", "Dancing Girl"],
];

type Rgb = [number, number, number];
const toHex = (c: readonly number[]) => "#" + c.map((n) => n.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function Select({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[][]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select className="input" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-300">
      <input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Range({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}: {value}%</label>
      <input id={id} type="range" min={0} max={100} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-cyan-500" />
    </div>
  );
}

export function DeviceSettingsForm({ initial, readOnly }: { initial: DeviceConfig; readOnly: boolean }) {
  const [dc, setDc] = useState<DeviceConfig>(initial);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof DeviceConfig>(k: K, v: DeviceConfig[K]) => setDc((d) => ({ ...d, [k]: v }));
  const env = dc.environment_config;
  const light = dc.light_config;
  const mode = MODES.find(([v]) => v === dc.light_mode) ?? MODES[0]!;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setState(await saveDevice(dc)));
      }}
    >
      <fieldset disabled={readOnly || pending} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Range id="brightness" label="Brightness" value={dc.brightness} onChange={(v) => set("brightness", v)} />
          <Select id="time_format" label="Time Format" value={dc.time_format === "24h" ? "24h" : "12h"} options={[["12h", "12 Hour"], ["24h", "24 Hour"]]} onChange={(v) => set("time_format", v)} />
        </div>

        <div>
          <Select id="light_mode" label="Display Mode" value={mode[0]} options={MODES.map(([v, l]) => [v, l])} onChange={(v) => set("light_mode", v)} />
          <p className="mt-1 text-xs text-gray-500">{mode[2]}</p>
        </div>

        {dc.light_mode === "env" && (
          <div className="grid gap-4 rounded-lg border border-gray-700 p-4 sm:grid-cols-2">
            <Select id="clock_design" label="Clock Design" value={env.clock_design || "digital"} options={CLOCKS} onChange={(v) => set("environment_config", { ...env, clock_design: v })} />
            <div>
              <label className="label" htmlFor="env_color">Accent Color</label>
              <input id="env_color" type="color" className="h-9 w-20 cursor-pointer rounded bg-transparent" value={toHex(env.color)} onChange={(e) => set("environment_config", { ...env, color: fromHex(e.target.value) })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Check label="Show Date" checked={env.show_date} onChange={(v) => set("environment_config", { ...env, show_date: v })} />
              <Check label="Show Weather" checked={env.show_weather} onChange={(v) => set("environment_config", { ...env, show_weather: v })} />
              <Check label="Show Temperature" checked={env.show_temp} onChange={(v) => set("environment_config", { ...env, show_temp: v })} />
              <Check label="Show Divoom Logo" checked={env.show_divoom} onChange={(v) => set("environment_config", { ...env, show_divoom: v })} />
            </div>
          </div>
        )}

        {dc.light_mode === "light" && (
          <div className="grid gap-4 rounded-lg border border-gray-700 p-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="light_color">Light Color</label>
              <input id="light_color" type="color" className="h-9 w-20 cursor-pointer rounded bg-transparent" value={toHex(light.color)} onChange={(e) => set("light_config", { ...light, color: fromHex(e.target.value) })} />
            </div>
            <Range id="light_brightness" label="Light brightness" value={light.brightness} onChange={(v) => set("light_config", { ...light, brightness: v })} />
            <Select id="effect_mode" label="Effect Mode" value={String(light.effect_mode)} options={EFFECTS.map((l, i) => [String(i), l])} onChange={(v) => set("light_config", { ...light, effect_mode: +v })} />
            <div className="flex items-end"><Check label="Light On" checked={light.on} onChange={(v) => set("light_config", { ...light, on: v })} /></div>
          </div>
        )}

        {dc.light_mode === "special" && (
          <div className="rounded-lg border border-gray-700 p-4">
            <Select id="special" label="Special Effect" value={dc.special_config.mode || "default"} options={SPECIALS} onChange={(v) => set("special_config", { mode: v })} />
          </div>
        )}

        {dc.light_mode === "music" && (
          <div className="rounded-lg border border-gray-700 p-4">
            <Select id="music" label="Visualization Style" value={dc.music_config.mode || "bottom_bars"} options={MUSIC} onChange={(v) => set("music_config", { mode: v })} />
          </div>
        )}

        {dc.light_mode === "score" && (
          <div className="grid gap-4 rounded-lg border border-gray-700 p-4 sm:grid-cols-2">
            {(["red_score", "blue_score"] as const).map((k) => (
              <div key={k}>
                <label className="label" htmlFor={k}>{k === "red_score" ? "Red Score (0-999)" : "Blue Score (0-999)"}</label>
                <input
                  className="input"
                  id={k}
                  type="number"
                  min={0}
                  max={999}
                  value={dc.score_config[k]}
                  onChange={(e) => set("score_config", { ...dc.score_config, [k]: Math.max(0, Math.min(999, +e.target.value || 0)) })}
                />
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <Alert state={state} />
      {!readOnly && <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save Device Config"}</button>}
    </form>
  );
}
