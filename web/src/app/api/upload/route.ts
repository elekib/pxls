// Image upload for Image pages. the content decides
// the type, names are generated, size and dimensions are capped.

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { MAX_UPLOAD_BYTES, sanitizeStem, uploadsDir, validateImageBytes } from "@/lib/uploads/guard";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json(400, { error: "File too large (max 5MB)" });
  }
  let file: File | null = null;
  try {
    for (const v of (await req.formData()).values()) {
      if (typeof v !== "string") {
        file = v;
        break;
      }
    }
  } catch {
    return json(400, { error: "Failed to read file (too large or malformed)" });
  }
  if (!file) return json(400, { error: "No file uploaded" });
  if (file.size > MAX_UPLOAD_BYTES) return json(400, { error: "File too large (max 5MB)" });

  const data = new Uint8Array(await file.arrayBuffer());
  let ext: string;
  try {
    ext = await validateImageBytes(data);
  } catch (e) {
    return json(400, { error: (e as Error).message });
  }
  const original = file.name || "upload";
  const stored = `${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString("hex")}_${sanitizeStem(original)}.${ext}`;
  try {
    await mkdir(uploadsDir(), { recursive: true });
    await writeFile(path.join(uploadsDir(), stored), data, { flag: "wx" });
  } catch {
    return json(500, { error: "Failed to save file" });
  }
  return json(200, { success: true, filename: stored, original_name: original, size: data.length });
}
