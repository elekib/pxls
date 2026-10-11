// System, GPU and temperature pages from Dash. or a Beszel hub.

import { hexToRgb } from "@/lib/config/model";
import { Canvas, type Rgb } from "../canvas";
import { drawText } from "../font";
import { fetchSystemRecord, hubGet, type TokenManager } from "../beszel";

const DASHDOT_TIMEOUT_MS = 3000;
const OFFLINE: Rgb = [100, 100, 100];

/** Rounds, then saturates at 0. */
const u32 = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);

export function usageColor(n: number): Rgb {
  return n <= 50 ? [0, 255, 0] : n <= 75 ? [255, 255, 0] : n <= 90 ? [255, 165, 0] : [255, 0, 0];
}

export function tempColor(n: number): Rgb {
  return n <= 50 ? [0, 255, 0] : n <= 70 ? [255, 255, 0] : n <= 85 ? [255, 165, 0] : [255, 0, 0];
}

async function dashdot(base: string, path: string): Promise<unknown> {
  const r = await fetch(`${base.replace(/\/+$/, "")}${path}`, { signal: AbortSignal.timeout(DASHDOT_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export interface StatsPage {
  source: string;
  dashdot_url?: string | null;
  beszel_hub_url?: string | null;
  beszel_system_id?: string | null;
  brand_text: string;
  brand_color: string;
}

const beszelOf = (p: StatsPage) => (p.source === "beszel" && p.beszel_hub_url ? p.beszel_hub_url : null);
const dashdotOf = (p: StatsPage) => (p.source !== "beszel" && p.dashdot_url ? p.dashdot_url : null);

// ---- system --------------------------------------------------------------

export async function systemStats(p: StatsPage, tm: TokenManager | null): Promise<{ cpu: number | null; ram: number | null }> {
  const hub = beszelOf(p);
  if (hub) {
    const r = await fetchSystemRecord(hub, p.beszel_system_id ?? null, tm);
    const info = r?.record.info as { cpu?: number; mp?: number } | undefined;
    return { cpu: u32(info?.cpu), ram: u32(info?.mp) };
  }
  const url = dashdotOf(p);
  if (!url) return { cpu: null, ram: null };
  const [cores, info, ram] = await Promise.all([
    dashdot(url, "/load/cpu").catch(() => null),
    dashdot(url, "/info").catch(() => null),
    dashdot(url, "/load/ram").catch(() => null),
  ]);
  let cpu: number | null = null;
  if (Array.isArray(cores) && cores.length > 0) {
    const loads = cores.map((c) => Number((c as { load?: number }).load ?? 0));
    cpu = u32(loads.reduce((a, b) => a + b, 0) / loads.length);
  }
  const total = (info as { ram?: { size?: number } } | null)?.ram?.size;
  const used = (ram as { load?: number } | null)?.load;
  let ramPct: number | null = null;
  if (typeof used === "number" && typeof total === "number") ramPct = total > 0 ? Math.max(0, Math.trunc((used / total) * 100)) : 0;
  return { cpu, ram: ramPct };
}

export function drawSystemStats(p: StatsPage, s: { cpu: number | null; ram: number | null }): Canvas {
  const c = new Canvas();
  if (s.cpu !== null && s.ram !== null) {
    drawText(c, `C${s.cpu}%`, 0, 0, usageColor(s.cpu), 1);
    drawText(c, `R${s.ram}%`, 0, 6, usageColor(s.ram), 1);
  } else {
    drawText(c, "C--", 0, 0, OFFLINE, 1);
    drawText(c, "R--", 0, 6, OFFLINE, 1);
  }
  drawText(c, p.brand_text, 0, 11, hexToRgb(p.brand_color), 0);
  return c;
}

// ---- GPU -----------------------------------------------------------------

export async function gpuLoad(p: StatsPage, tm: TokenManager | null): Promise<number | null> {
  const hub = beszelOf(p);
  if (hub) {
    const r = await fetchSystemRecord(hub, p.beszel_system_id ?? null, tm);
    const info = r?.record.info as Record<string, unknown> | undefined;
    if (!info) return null;
    if (Array.isArray(info.gpu)) return u32((info.gpu[0] as { load?: number } | undefined)?.load);
    if (info.gpu_usage != null || info.gpu_memory_used != null) return u32(info.gpu_usage);
    if (typeof info.g === "number") return u32(info.g);
    return null;
  }
  const url = dashdotOf(p);
  if (!url) return null;
  const gpus = await dashdot(url, "/load/gpu").catch(() => null);
  return Array.isArray(gpus) && gpus.length > 0 ? u32((gpus[0] as { load?: number }).load ?? 0) : null;
}

export function drawGpuStats(p: StatsPage, load: number | null): Canvas {
  const c = new Canvas();
  if (load !== null) drawText(c, `L${load}%`, 0, 0, usageColor(load), 1);
  else drawText(c, "L--", 0, 0, OFFLINE, 1);
  drawText(c, p.brand_text, 0, 11, hexToRgb(p.brand_color), 0);
  return c;
}

// ---- temperatures --------------------------------------------------------

export interface TempsPage extends StatsPage {
  show_cpu: boolean;
  show_gpu: boolean;
  show_storage: boolean;
}

export interface Temps {
  cpu: number | null;
  gpu: number | null;
  storage: number | null;
}

async function smartStorageTemp(hub: string, systemId: string, token: string | null): Promise<number | null> {
  try {
    const data = (await hubGet(
      `${hub}/api/collections/smart_devices/records?filter=system='${systemId}'&perPage=100`,
      token,
    )) as { items?: { temp?: number | null; attributes?: { n: string; rv: number }[] | null }[] };
    for (const d of data.items ?? []) {
      if (typeof d.temp === "number" && d.temp > 0) return Math.round(d.temp);
      for (const a of d.attributes ?? []) if (a.n === "Temperature" && a.rv > 0) return a.rv;
    }
  } catch {
    // No SMART data on this hub.
  }
  return null;
}

export async function temps(p: TempsPage, tm: TokenManager | null): Promise<Temps> {
  const hub = beszelOf(p);
  if (hub) {
    const r = await fetchSystemRecord(hub, p.beszel_system_id ?? null, tm);
    if (!r) return { cpu: null, gpu: null, storage: null };
    const info = r.record.info as { dt?: number; gpuTemp?: number; temps?: Record<string, unknown> } | undefined;
    const t = info?.temps;
    const sensor = t ? (t.nvme_composite ?? t.nvme_composite_2 ?? t.storage ?? t.disk) : undefined;
    const storage = u32(sensor) ?? (await smartStorageTemp(hub, r.id, r.token));
    return { cpu: u32(info?.dt), gpu: u32(info?.gpuTemp), storage };
  }
  const url = dashdotOf(p);
  if (!url) return { cpu: null, gpu: null, storage: null };
  const cores = await dashdot(url, "/load/cpu").catch(() => null);
  const cpu = Array.isArray(cores) && cores.length > 0 ? u32(Math.max(0, ...cores.map((c) => Number((c as { temp?: number }).temp ?? 0)))) : null;
  return { cpu, gpu: null, storage: null };
}

export function drawTemps(p: TempsPage, t: Temps): Canvas {
  const c = new Canvas();
  const rows: [string, number | null][] = [];
  if (p.show_cpu) rows.push(["C", t.cpu]);
  if (p.show_gpu) rows.push(["G", t.gpu]);
  if (p.show_storage) rows.push(["S", t.storage]);
  const shown = rows.slice(0, 2);
  const ys = shown.length === 2 ? [0, 6] : [0];
  shown.forEach(([label, v], i) => {
    const y = ys[i] ?? 0;
    if (v !== null) {
      const s = `${label}${v}`;
      drawText(c, s, 0, y, tempColor(v), 1);
      drawText(c, "*", s.length * 4, y, tempColor(v), 0);
    } else {
      drawText(c, `${label}--*`, 0, y, OFFLINE, 1);
    }
  });
  if (shown.length === 0) drawText(c, "NO TMP", 0, 0, OFFLINE, 1);
  drawText(c, p.brand_text, 0, 11, hexToRgb(p.brand_color), 0);
  return c;
}
