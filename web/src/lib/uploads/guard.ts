// Validation for images that come from outside (uploads, fetched URLs) and
// safe handling of stored upload filenames.

import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dataDir } from "@/lib/db/sqlite";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16 * 1024 * 1024;

// The hint keeps the build tracer from bundling every file named "uploads".
export const uploadsDir = () => path.join(/* turbopackIgnore: true */ dataDir(), "uploads");

/** Detect the format from magic bytes; the filename is never trusted. */
export function sniffFormat(b: Uint8Array): "png" | "jpg" | "gif" | "bmp" | "webp" | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x42, 0x4d)) return "bmp";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

/**
 * Check an image's real content: one of the allowed formats, readable, and not
 * too large (dimensions come from the header, so decompression bombs never
 * get decoded). Returns the canonical extension.
 */
export async function validateImageBytes(data: Uint8Array): Promise<string> {
  const ext = sniffFormat(data);
  if (!ext) throw new Error(data.length >= 4 ? "Invalid file type. Allowed: PNG, JPG, GIF, BMP, WEBP" : "Not a recognised image file");
  let w = 0;
  let h = 0;
  try {
    // libvips cannot read BMP; take its size from the header instead.
    if (ext === "bmp") {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      w = Math.abs(v.getInt32(18, true));
      h = Math.abs(v.getInt32(22, true));
    } else {
      const m = await sharp(data, { limitInputPixels: false }).metadata();
      w = m.width ?? 0;
      h = m.pageHeight ?? m.height ?? 0;
    }
  } catch {
    throw new Error("Corrupt or unsupported image");
  }
  if (w === 0 || h === 0 || w > MAX_DIMENSION || h > MAX_DIMENSION || w * h > MAX_PIXELS) {
    throw new Error(`Image too large (max ${MAX_DIMENSION}x${MAX_DIMENSION})`);
  }
  return ext;
}

/** A client filename reduced to a safe stem: [A-Za-z0-9_-], at most 64 chars. */
export function sanitizeStem(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = [...stem]
    .map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : "_"))
    .join("")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return cleaned || "upload";
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };

/** Content type by extension; anything else is never served. */
export function contentTypeFor(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (TYPES[name.slice(dot + 1).toLowerCase()] ?? null);
}

/**
 * Resolve `name` inside `base`, refusing anything that is not a plain file
 * directly under it (blocks .., separators, absolute paths and symlinks out).
 */
export function resolveUploadPath(base: string, name: string): string | null {
  if (!name || name.startsWith(".") || /[/\\\0]/.test(name)) return null;
  try {
    const root = realpathSync(base);
    const file = realpathSync(path.join(root, name));
    return path.dirname(file) === root && statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}
