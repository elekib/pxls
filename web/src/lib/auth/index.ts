import { getDb } from "@/lib/db/sqlite";
import { AuthService } from "./service";
import { AccountsStore } from "./store";

declare global {
  var __pxlsAuth: AuthService | undefined;
}

/** The process-wide auth service. Prints the setup code on first use if needed. */
export function getAuth(): AuthService {
  globalThis.__pxlsAuth ??= AuthService.init(new AccountsStore(getDb()));
  return globalThis.__pxlsAuth;
}
