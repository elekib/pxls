import { describe, expect, it } from "vitest";
import { clientIp, cookieValue, csrfOk } from "@/lib/auth/http";
import type { AuthService } from "@/lib/auth/service";

const h = (o: Record<string, string>) => new Headers(o);
const auth = { allowedOrigins: ["https://pxls.example"] } as AuthService;

describe("clientIp", () => {
  it("uses the real peer and ignores client-supplied headers from public peers", () => {
    expect(clientIp(h({ "x-pxls-peer": "203.0.113.9", "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("203.0.113.9");
  });
  it("honours X-Real-IP from a private proxy", () => {
    expect(clientIp(h({ "x-pxls-peer": "::ffff:192.168.1.2", "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-pxls-peer": "127.0.0.1", "x-real-ip": "not an ip" }))).toBe("127.0.0.1");
  });
  it("strips the IPv4-mapped prefix and falls back to unknown", () => {
    expect(clientIp(h({ "x-pxls-peer": "::ffff:203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("csrfOk", () => {
  it("needs the custom header", () => {
    expect(csrfOk(h({}), auth)).toBe(false);
    expect(csrfOk(h({ "x-requested-with": "pxls" }), auth)).toBe(true);
  });
  it("accepts same-host and listed origins only", () => {
    const base = { "x-requested-with": "pxls", host: "pxls.local:3500" };
    expect(csrfOk(h({ ...base, origin: "http://pxls.local:3500" }), auth)).toBe(true);
    expect(csrfOk(h({ ...base, origin: "https://pxls.example/" }), auth)).toBe(true);
    expect(csrfOk(h({ ...base, origin: "https://evil.example" }), auth)).toBe(false);
  });
});

describe("cookieValue", () => {
  it("finds a named cookie", () => {
    expect(cookieValue(h({ cookie: "a=1; pxls_refresh=tok; b=2" }), "pxls_refresh")).toBe("tok");
    expect(cookieValue(h({ cookie: "pxls_refresh=" }), "pxls_refresh")).toBeNull();
  });
});
