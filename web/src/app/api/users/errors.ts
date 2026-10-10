import { error } from "@/lib/auth/http";
import { USER_ERROR_MESSAGES, type UserError } from "@/lib/auth/store";

export function userError(e: UserError): Response {
  return error(e === "not-found" ? 404 : 409, USER_ERROR_MESSAGES[e]);
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
