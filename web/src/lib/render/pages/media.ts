// Uploaded image and custom script pages. Port of pages/image_upload.rs and
// pages/custom_script.rs.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { decodeBmp } from "@/lib/uploads/bmp";
import { hexToRgb } from "@/lib/config/model";
import { resolveUploadPath, uploadsDir } from "@/lib/uploads/guard";
import { Canvas, SIZE } from "../canvas";
import { drawText } from "../font";
import type { Pixel, ScriptInput } from "../pageTypes";

const SCRIPT_TIMEOUT_MS = 5000;

function label(text: string, x: number, color: [number, number, number]): Canvas {
  const c = new Canvas();
  drawText(c, text, x, 6, color, 0);
  return c;
}

/** 16x16 RGB of an image, resized with Lanczos3 like the Rust code; alpha dropped. */
async function staticFrame(file: string): Promise<Canvas> {
  let input = sharp(file, { pages: 1 });
  if (file.toLowerCase().endsWith(".bmp")) {
    const bmp = decodeBmp(await readFile(file));
    input = sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } });
  }
  const { data } = await input
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Canvas.from(data);
}

interface Gif {
  frames: Canvas[];
  delays: number[];
}

const gifCache = new Map<string, Gif>();
const gifStart = new Map<string, number>();

async function loadGif(file: string): Promise<Gif> {
  // For animated input sharp sizes each frame: 16x16 here means every frame,
  // and the output is the frames stacked vertically (pageHeight 16).
  const { data, info } = await sharp(file, { animated: true })
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const meta = await sharp(file, { animated: true }).metadata();
  const frameBytes = SIZE * SIZE * 3;
  const pages = Math.max(1, Math.floor(info.height / (info.pageHeight ?? SIZE)));
  if (info.width !== SIZE || (info.pageHeight ?? SIZE) !== SIZE || data.length < pages * frameBytes) {
    throw new Error(`unexpected GIF frame layout ${info.width}x${info.pageHeight ?? info.height}`);
  }
  const frames = Array.from({ length: pages }, (_, i) => Canvas.from(data.subarray(i * frameBytes, (i + 1) * frameBytes)));
  // GIF delays are in ms here; 0 means "as fast as possible", shown as 100 ms
  // (Rust divided real delays by ten, playing every GIF ten times too fast).
  const delays = frames.map((_, i) => meta.delay?.[i] || 100);
  return { frames, delays };
}

export function gifFrameIndex(gif: Gif, elapsedMs: number, fixedMs: number): number {
  if (fixedMs > 0) return Math.floor((elapsedMs % (fixedMs * gif.frames.length)) / fixedMs) % gif.frames.length;
  const total = gif.delays.reduce((a, b) => a + b, 0);
  let t = elapsedMs % total;
  for (let i = 0; i < gif.delays.length; i++) {
    t -= gif.delays[i]!;
    if (t < 0) return i;
  }
  return 0;
}

export async function renderImageUpload(mode: string, filePath: string | null | undefined, frameDuration: number): Promise<Canvas> {
  if (!filePath) return label(mode === "animated" ? "GIF" : "IMG", 4, [100, 100, 100]);
  const file = resolveUploadPath(uploadsDir(), filePath);
  if (!file) return label("?", 7, [255, 0, 0]);
  try {
    if (mode === "animated" && filePath.toLowerCase().endsWith(".gif")) {
      let gif = gifCache.get(filePath);
      if (!gif) {
        gif = await loadGif(file);
        gifCache.set(filePath, gif);
      }
      if (!gifStart.has(filePath)) gifStart.set(filePath, Date.now());
      return gif.frames[gifFrameIndex(gif, Date.now() - gifStart.get(filePath)!, frameDuration)]!;
    }
    return await staticFrame(file);
  } catch {
    return label("ERR", 3, [255, 0, 0]);
  }
}

/**
 * Run the page's shell command with INPUT_<NAME> variables. JSON pixel output
 * is drawn; any other output shows its first five characters. Admin-configured
 * only. Unlike Rust, a hung script is stopped after 5 s.
 */
export function renderCustomScript(scriptPath: string, inputs: ScriptInput[]): Promise<Canvas> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const i of inputs ?? []) env[`INPUT_${String(i.name).toUpperCase()}`] = String(i.default_value ?? "");
  return new Promise((resolve) => {
    execFile("sh", ["-c", scriptPath], { env, timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(label("ERR", 4, [255, 0, 0]));
      try {
        const pixels = JSON.parse(stdout) as Pixel[];
        if (!Array.isArray(pixels)) throw new Error();
        const c = new Canvas();
        for (const p of pixels) if (p.x >= 0 && p.x < 16 && p.y >= 0 && p.y < 16) c.put(p.x, p.y, hexToRgb(String(p.color)));
        resolve(c);
      } catch {
        const first = (stdout.split("\n")[0] ?? "script") || "script";
        const c = new Canvas();
        drawText(c, [...first].slice(0, 5).join(""), 0, 6, [255, 255, 255], 0);
        resolve(c);
      }
    });
  });
}
