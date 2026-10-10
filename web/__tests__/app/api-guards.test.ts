// Every API route must check the session itself (requireApi), directly or
// through a local helper that does, unless its path is on the public list.
// proxy.ts already blocks unauthenticated calls; this keeps roles and CSRF
// from being forgotten on a new route.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/policy";

const API = path.resolve(__dirname, "../../src/app/api");

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === "route.ts" ? [p] : [];
  });
}

const read = (p: string) => readFileSync(p, "utf8");

/** True if the file calls requireApi, or imports a sibling/parent module that does. */
function guarded(file: string): boolean {
  const src = read(file);
  if (src.includes("requireApi(")) return true;
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    const base = path.resolve(path.dirname(file), m[1]!);
    for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
      try {
        if (read(candidate).includes("requireApi(")) return true;
      } catch {
        /* not this candidate */
      }
    }
  }
  return false;
}

const urlOf = (file: string) => "/api/" + path.relative(API, path.dirname(file)).split(path.sep).join("/");

describe("API route guards", () => {
  const files = routes(API);

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [urlOf(f), f]))("%s is guarded or public", (url, file) => {
    expect(guarded(file as string) || isPublicPath(url as string)).toBe(true);
  });

  it("keeps the public list short", () => {
    const open = files.map(urlOf).filter((u) => isPublicPath(u) && !guarded(files.find((f) => urlOf(f) === u)!));
    expect(open.sort()).toEqual(["/api/auth/[...all]", "/api/auth/status", "/api/health", "/api/webhook/[name]"]);
  });
});
