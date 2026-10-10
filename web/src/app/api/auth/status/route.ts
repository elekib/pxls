import { getAuth } from "@/lib/auth";
import { json } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json(200, { setup_required: getAuth().setupRequired() });
}
