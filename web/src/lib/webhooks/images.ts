// Images for webhook actions. url,
// base64, template and text_overlay sources, then a "cover" resize to the
// action's width x height (16x16 by default) with an optional crop_y_offset.
// Templates draw text with the bitmap font.

import sharp from "sharp";
import { Canvas } from "@/lib/render/canvas";
import { drawText } from "@/lib/render/font";
import { validateImageBytes } from "@/lib/uploads/guard";
import type { Action, Json } from "./model";
import { fetchImageBytes } from "./netGuard";

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

const num = (v: Json | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined);
const str = (v: Json | undefined) => (typeof v === "string" ? v : undefined);

function fromCanvas(c: Canvas): Rgba {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) data.set([c.data[i * 3], c.data[i * 3 + 1], c.data[i * 3 + 2], 255], i * 4);
  return { width: 16, height: 16, data };
}

function hex(s: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const h = (s ?? "").replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] : fallback;
}

/** Scale to cover width x height, then centre-crop (crop_y_offset slides the window down). */
async function withParams(input: Buffer, action: Action): Promise<Rgba> {
  const tw = Math.max(1, num(action.parameters.width) ?? 16);
  const th = Math.max(1, num(action.parameters.height) ?? 16);
  const meta = await sharp(input, { pages: 1 }).metadata();
  const ow = meta.width ?? 0;
  const oh = meta.pageHeight ?? meta.height ?? 0;
  let img = sharp(input, { pages: 1 }).ensureAlpha();
  if (ow > 0 && oh > 0 && (ow !== tw || oh !== th)) {
    const scale = Math.max(tw / ow, th / oh);
    const sw = Math.max(1, Math.round(ow * scale));
    const sh = Math.max(1, Math.round(oh * scale));
    const exW = Math.max(0, sw - tw);
    const exH = Math.max(0, sh - th);
    const offset = typeof action.parameters.crop_y_offset === "number" ? Math.trunc(action.parameters.crop_y_offset) : 0;
    const top = Math.min(exH, Math.max(0, Math.floor(exH / 2) + offset));
    img = sharp(await img.resize(sw, sh, { fit: "fill", kernel: "lanczos3" }).png().toBuffer()).extract({
      left: Math.floor(exW / 2),
      top,
      width: Math.min(tw, sw),
      height: Math.min(th, sh),
    });
  }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

async function download(url: string, what: string): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await fetchImageBytes(url);
  } catch (e) {
    throw new Error(`Failed to download ${what}: ${(e as Error).message}`);
  }
  try {
    await validateImageBytes(bytes);
  } catch (e) {
    throw new Error(`Rejected ${what === "image" ? "downloaded image" : what}: ${(e as Error).message}`);
  }
  return bytes;
}

export async function processImageAction(action: Action, payload: Json): Promise<Rgba> {
  if (action.action_type !== "DisplayImage") throw new Error("Not an image action");
  const source = str(action.parameters.image_source);
  if (!source) throw new Error("Missing image_source parameter");
  switch (source) {
    case "url": {
      const url = str(action.parameters.url);
      if (!url) throw new Error("Missing url parameter");
      return withParams(await download(url, "image"), action);
    }
    case "base64": {
      const data = str(action.parameters.base64_data);
      if (!data) throw new Error("Missing base64_data parameter");
      const bytes = Buffer.from(data.split(",").pop() ?? data, "base64");
      try {
        await sharp(bytes).metadata();
      } catch (e) {
        throw new Error(`Failed to parse base64 image: ${(e as Error).message}`);
      }
      return withParams(bytes, action);
    }
    case "template":
      return template(action, payload);
    case "text_overlay": {
      const base = str(action.parameters.base_image_url);
      if (!base) throw new Error("Missing base_image_url parameter");
      const img = await withParams(await download(base, "base image"), { ...action, parameters: { ...action.parameters, width: 16, height: 16 } });
      const c = new Canvas();
      for (let i = 0; i < 256; i++) c.data.set([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]], i * 3);
      drawText(c, str(action.parameters.overlay_text) ?? "", 1, 5, hex(str(action.parameters.text_color), [255, 255, 255]), 1);
      return fromCanvas(c);
    }
    default:
      throw new Error(`Unsupported image source: ${source}`);
  }
}

function template(action: Action, payload: Json): Rgba {
  const p = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as Record<string, Json>;
  const type = str(action.parameters.template_type) ?? "notification";
  if (type === "notification") {
    const bg = str(action.parameters.background_color) ?? "1a1a1a";
    if (!/^#?[0-9a-fA-F]{6}$/.test(bg)) throw new Error("Invalid hex color format");
    const c = new Canvas(hex(bg, [26, 26, 26]));
    const title = str(p.title) ?? str(p.subject) ?? "Alert";
    const text = str(p.text) ?? str(p.message) ?? "";
    drawText(c, title.toUpperCase(), 1, 2, [255, 255, 255], 1);
    drawText(c, text.toUpperCase(), 1, 9, [204, 204, 204], 1);
    return fromCanvas(c);
  }
  if (type === "status") {
    const status = str(p.status) ?? "unknown";
    const color: [number, number, number] =
      status === "success" || status === "ok" ? [0, 255, 0] : status === "error" || status === "fail" ? [255, 0, 0] : status === "warning" || status === "warn" ? [255, 255, 0] : [128, 128, 128];
    const c = new Canvas(color);
    drawText(c, status.toUpperCase(), 1, 6, [0, 0, 0], 1);
    return fromCanvas(c);
  }
  if (type === "chart") {
    const c = new Canvas();
    const data = Array.isArray(p.chart_data) ? p.chart_data : [];
    data.forEach((v, i) => {
      if (typeof v === "number") c.put((i * 2) % 14, 12 - (Math.max(0, Math.trunc(v)) % 12), [0, 255, 0]);
    });
    return fromCanvas(c);
  }
  throw new Error(`Unknown template type: ${type}`);
}
