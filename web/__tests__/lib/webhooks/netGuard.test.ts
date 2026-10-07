import { describe, expect, it } from "vitest";
import { fetchImageBytes, isBlockedIp, validateUrl } from "@/lib/webhooks/netGuard";

describe("net guard", () => {
  it("blocks private and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "255.255.255.255", "224.0.0.1", "100.64.0.1", "100.127.255.255", "192.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "ff02::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("accepts only plain http(s) URLs", () => {
    expect(validateUrl("https://image.tmdb.org/t/p/w300/x.jpg").hostname).toBe("image.tmdb.org");
    for (const bad of ["ftp://x/a.png", "file:///etc/passwd", "https://user:pw@x/a.png", "not a url", "javascript:alert(1)"]) {
      expect(() => validateUrl(bad), bad).toThrow();
    }
  });

  it("refuses internal targets, including encoded IP forms", async () => {
    for (const u of ["http://127.0.0.1/a.png", "http://localhost/a.png", "http://[::1]/a.png", "http://169.254.169.254/latest/meta-data/", "http://192.168.1.10:8096/Items/1/Images/Primary", "http://0.0.0.0:3400/api/config", "http://2130706433/", "http://0x7f.0.0.1/"]) {
      await expect(fetchImageBytes(u, false), u).rejects.toThrow(/not allowed|private or reserved/);
    }
    await expect(fetchImageBytes("file:///etc/passwd", true)).rejects.toThrow();
  });
});
