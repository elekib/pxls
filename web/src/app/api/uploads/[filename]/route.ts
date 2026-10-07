import { readFile } from "node:fs/promises";
import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { contentTypeFor, resolveUploadPath, uploadsDir } from "@/lib/uploads/guard";

export async function GET(req: Request, ctx: { params: Promise<{ filename: string }> }) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const { filename } = await ctx.params;
  const type = contentTypeFor(filename);
  const file = type ? resolveUploadPath(uploadsDir(), filename) : null;
  if (!type || !file) return json(404, { error: "File not found" });
  try {
    return new Response(await readFile(file), {
      headers: { "content-type": type, "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600" },
    });
  } catch {
    return json(404, { error: "File not found" });
  }
}
