import { requireApi } from "@/lib/auth/api";
import { error, json, readJson } from "@/lib/auth/http";
import { getConfig, publicConfig, updateConfig } from "@/lib/device/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  return json(200, publicConfig(getConfig()));
}

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const body = await readJson<unknown>(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) return error(400, "Invalid config");
  try {
    return json(200, { success: true, config: publicConfig(updateConfig(body)) });
  } catch (e) {
    return json(500, { error: `Failed to save config: ${(e as Error).message}` });
  }
}
