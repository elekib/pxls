// SSRF guard for fetching images from URLs that arrive in webhook payloads.
// http/https only; every address the host resolves to
// must be public unless PXLS_ALLOW_PRIVATE_URLS=true; redirects are followed
// by hand so each hop is checked; and the connection is pinned to the address
// that was checked, so DNS cannot change between check and connect.

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

export const allowPrivateFromEnv = () => ["1", "true", "yes"].includes((process.env.PXLS_ALLOW_PRIVATE_URLS ?? "").trim().toLowerCase());

function blockedV4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  const [a, b, c] = o;
  return (
    a === 127 || // loopback
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local, includes cloud metadata 169.254.169.254
    a === 0 || // unspecified and "this network"
    o.every((x) => x === 255) || // broadcast
    (a >= 224 && a <= 239) || // multicast
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || // documentation
    (a === 100 && (b & 0xc0) === 64) || // 100.64.0.0/10 carrier-grade NAT
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
    a >= 240 // reserved
  );
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) return blockedV4(ip);
  if (isIP(ip) !== 6) return true;
  const l = ip.toLowerCase();
  const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedV4(mapped[1]);
  const first = parseInt(l.split(":")[0] || "0", 16);
  return (
    l === "::1" ||
    l === "::" ||
    (first & 0xff00) === 0xff00 || // multicast
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 // link-local fe80::/10
  );
}

/** http/https only, with a host and no embedded credentials. */
export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
  if (!url.hostname) throw new Error("URL has no host");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed");
  return url;
}

/** The address to connect to, checked against the private ranges. */
async function resolveChecked(url: URL, allowPrivate: boolean): Promise<{ address: string; family: number }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!allowPrivate && isBlockedIp(host)) throw new Error("Address is not allowed (private or reserved range)");
    return { address: host, family: isIP(host) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve host");
  }
  if (addrs.length === 0) throw new Error("Could not resolve host");
  if (!allowPrivate && addrs.some((a) => isBlockedIp(a.address))) throw new Error("Host resolves to a private or reserved address");
  return addrs[0];
}

interface Hop {
  status: number;
  location?: string;
  body?: Buffer;
}

function get(url: URL, pin: { address: string; family: number }): Promise<Hop> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(
      url,
      {
        headers: { "user-agent": "pxls" },
        timeout: REQUEST_TIMEOUT_MS,
        // Connect to the address we checked, whatever DNS says now.
        lookup: (_host, opts, cb) =>
          (opts as { all?: boolean }).all
            ? (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pin])
            : cb(null, pin.address, pin.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ status });
        }
        if (Number(res.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES) {
          res.destroy();
          return reject(new Error("Image is too large"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_IMAGE_BYTES) {
            res.destroy();
            reject(new Error("Image is too large"));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
        res.on("error", (e) => reject(new Error(`Read failed: ${e.message}`)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", (e) => reject(new Error(`Request failed: ${e.message}`)));
  });
}

/** Download an image body with the SSRF checks applied. */
export async function fetchImageBytes(raw: string, allowPrivate = allowPrivateFromEnv()): Promise<Buffer> {
  let current = validateUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const pin = await resolveChecked(current, allowPrivate);
    const hop = await get(current, pin);
    if (hop.status >= 300 && hop.status < 400) {
      if (!hop.location) throw new Error("Redirect without Location header");
      let next: URL;
      try {
        next = new URL(hop.location, current);
      } catch {
        throw new Error("Invalid redirect target");
      }
      current = validateUrl(next.href);
      continue;
    }
    if (hop.status < 200 || hop.status >= 300) throw new Error(`Server returned ${hop.status}`);
    return hop.body!;
  }
  throw new Error("Too many redirects");
}
