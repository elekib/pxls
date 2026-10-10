import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/auth/http";

const h = (o: Record<string, string>) => new Headers(o);

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
