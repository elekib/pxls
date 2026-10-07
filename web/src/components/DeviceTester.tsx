"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Command } from "@/lib/engine/commands";

const COLORS: [string, [number, number, number]][] = [
  ["Red", [255, 0, 0]],
  ["Green", [0, 255, 0]],
  ["Blue", [0, 0, 255]],
  ["White", [255, 255, 255]],
];

const MUSIC = ["Bottom bars", "Face 3", "Center bars", "Face 1", "Matrix", "Frog face", "Side bars", "Face 2",
  "Falling blocks", "Dancing boy", "Fireworks", "Dancing girl"];

export function DeviceTester() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [brightness, setBrightness] = useState(50);
  const [log, setLog] = useState<string[]>([]);

  async function send(cmd: Command) {
    setBusy(true);
    try {
      const res = await fetch("/api/debug/device", {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "pxls" },
        body: JSON.stringify(cmd),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setLog((l) => [`${cmd.action}: ${res.ok ? "ok" : body.error ?? res.status}`, ...l].slice(0, 8));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <section className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-cyan-600 space-y-3">
      <h3 className="text-xl font-semibold mb-4 text-cyan-300">Device test</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span>Brightness</span>
        <input className="min-w-32 flex-1 accent-cyan-500" type="range" min={0} max={100} value={brightness} onChange={(e) => setBrightness(+e.target.value)} />
        <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-sm" disabled={busy} onClick={() => send({ action: "brightness", value: brightness })}>
          Set {brightness}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {COLORS.map(([name, rgb]) => (
          <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-sm" key={name} disabled={busy} onClick={() => send({ action: "color", rgb })}>
            {name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-sm" disabled={busy} onClick={() => send({ action: "clock", design: 0, rgb: [255, 255, 255] })}>
          Clock
        </button>
        <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-sm" disabled={busy} onClick={() => send({ action: "score", red: 12, blue: 34 })}>
          Score 12:34
        </button>
        <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-sm" disabled={busy} onClick={() => send({ action: "buzzer", ms: 500 })}>
          Buzzer
        </button>
        <select className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm" disabled={busy} defaultValue="" onChange={(e) => e.target.value && send({ action: "music", mode: +e.target.value })}>
          <option value="" disabled>
            Music mode…
          </option>
          {MUSIC.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {log.length > 0 && (
        <pre className="whitespace-pre-wrap text-sm text-gray-400">
          {log.join("\n")}
        </pre>
      )}
    </section>
  );
}
