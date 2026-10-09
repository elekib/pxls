// Default-deny for the API: a non-public /api route is only reached with a
// live session, even if its handler forgets to call requireApi(). Roles and
// CSRF are still checked in requireApi(); this is the backstop.

import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { error } from "@/lib/auth/http";
import { isPublicPath } from "@/lib/auth/policy";

export async function proxy(req: NextRequest) {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();
  const session = await getAuth()
    .api.getSession({ headers: req.headers })
    .catch(() => null);
  if (!session || session.user.banned) return error(401, "Unauthorized");
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
