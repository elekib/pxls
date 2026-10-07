import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "@/lib/db/sqlite";
import {
  ACCESS_TTL_SECS,
  AuthService,
  constantTimeEq,
  formatSetupCode,
  hashPassword,
  nowSecs,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "@/lib/auth/service";
import { AccountsStore } from "@/lib/auth/store";

const SECRET = "0123456789abcdef0123456789abcdef";
const PASSWORD = "a long test passphrase";

function service() {
  return new AuthService(new AccountsStore(openMemoryDb()), SECRET);
}

async function withUser(role: "admin" | "viewer" = "viewer") {
  const auth = service();
  auth.store.createUser("bob", await hashPassword(PASSWORD), role, nowSecs());
  return auth;
}

describe("passwords and rules", () => {
  it("hashes with argon2id and unique salts", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, PASSWORD)).toBe(true);
    expect(await verifyPassword(a, PASSWORD + "x")).toBe(false);
    expect(await verifyPassword("not a hash", "x")).toBe(false);
  });

  it("applies the username and password rules", () => {
    expect(validatePassword("short", "bob")).toMatch(/at least 12/);
    expect(validatePassword("a".repeat(129), "bob")).toMatch(/at most 128/);
    expect(validatePassword("Bob-Is-The-Name", "bob-is-the-name")).toMatch(/same as the username/);
    expect(validatePassword(PASSWORD, "bob")).toBeNull();
    expect(validateUsername("ab")).not.toBeNull();
    expect(validateUsername("has space")).not.toBeNull();
    expect(validateUsername("ok.name_1-x")).toBeNull();
  });

  it("compares in constant time", () => {
    expect(constantTimeEq("abc", "abc")).toBe(true);
    expect(constantTimeEq("abc", "abd")).toBe(false);
    expect(constantTimeEq("abc", "abcd")).toBe(false);
    expect(constantTimeEq("", "")).toBe(true);
  });

  it("formats the setup code", () => {
    expect(formatSetupCode()).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){5}$/);
    expect(formatSetupCode()).not.toBe(formatSetupCode());
  });
});

describe("tokens", () => {
  it("round-trips and rejects tampered, foreign, expired and unsigned tokens", async () => {
    const auth = await withUser();
    const t = await auth.login("bob", PASSWORD, "1.1.1.1", null);
    if (!t.ok) throw new Error("login failed");
    const me = await auth.authenticate(t.value.accessToken);
    expect(me?.user.username).toBe("bob");

    const other = new AuthService(auth.store, "fedcba9876543210fedcba9876543210");
    expect(await other.authenticate(t.value.accessToken)).toBeNull();

    const [h, , s] = t.value.accessToken.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "1", sid: me!.sessionId, exp: nowSecs() + 999 })).toString("base64url");
    expect(await auth.authenticate(`${h}.${forged}.${s}`)).toBeNull();

    const old = await auth.issue(me!.user.id, me!.sessionId, nowSecs() - ACCESS_TTL_SECS - 5);
    expect(await auth.authenticate(old)).toBeNull();

    expect(await auth.authenticate("eyJhbGciOiJub25lIn0.e30.")).toBeNull();
    const noSid = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("1").setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
    expect(await auth.authenticate(noSid)).toBeNull();
  });

  it("stops accepting the token once the session is revoked", async () => {
    const auth = await withUser();
    const t = await auth.login("bob", PASSWORD, "1.1.1.1", null);
    if (!t.ok) throw new Error();
    auth.logoutToken(t.value.refreshToken);
    expect(await auth.authenticate(t.value.accessToken)).toBeNull();
    expect(auth.authenticateCookie(t.value.refreshToken)).toBeNull();
  });

  it("rotates refresh tokens and treats reuse as theft", async () => {
    const auth = await withUser();
    const t = await auth.login("bob", PASSWORD, "1.1.1.1", null);
    if (!t.ok) throw new Error();
    const r1 = await auth.refresh(t.value.refreshToken, "1.1.1.1");
    expect(r1.ok).toBe(true);
    expect((await auth.refresh(t.value.refreshToken, "1.1.1.1")).ok).toBe(false);
    if (r1.ok) expect((await auth.refresh(r1.value.refreshToken, "1.1.1.1")).ok).toBe(false);
  });

  it("resolves browser cookies", async () => {
    const auth = await withUser();
    const t = await auth.login("bob", PASSWORD, "1.1.1.1", "UA");
    if (!t.ok) throw new Error();
    expect(auth.authenticateCookie(t.value.refreshToken)?.user.username).toBe("bob");
    expect(auth.authenticateCookie("nope")).toBeNull();
  });
});

describe("login", () => {
  it("gives one answer for unknown users, wrong passwords and disabled accounts", async () => {
    const auth = await withUser();
    expect(await auth.login("nobody", PASSWORD, "1.1.1.1", null)).toEqual({ ok: false, error: "invalid" });
    expect(await auth.login("bob", "wrong password!!", "1.1.1.1", null)).toEqual({ ok: false, error: "invalid" });
    auth.store.createFirstAdmin("root", "h", nowSecs());
    auth.store.updateUser(auth.store.findUserWithHash("bob")!.user.id, undefined, true, nowSecs());
    expect(await auth.login("bob", PASSWORD, "1.1.1.2", null)).toEqual({ ok: false, error: "invalid" });
  });

  it("locks an account name after 5 failures, even for unknown names", async () => {
    const auth = await withUser();
    for (let i = 0; i < 5; i++) await auth.login("bob", "wrong password!!", `10.0.0.${i}`, null);
    const r = await auth.login("bob", PASSWORD, "10.0.0.99", null);
    expect(r).toMatchObject({ ok: false, error: "throttled" });
    for (let i = 0; i < 5; i++) await auth.login("ghost", "x", `10.0.1.${i}`, null);
    expect(await auth.login("ghost", "x", "10.0.1.99", null)).toMatchObject({ error: "throttled" });
  });

  it("locks an IP after 20 failures", async () => {
    const auth = await withUser();
    for (let i = 0; i < 20; i++) await auth.login(`name${i}`, "x", "9.9.9.9", null);
    expect(await auth.login("bob", PASSWORD, "9.9.9.9", null)).toMatchObject({ error: "throttled" });
    expect((await auth.login("bob", PASSWORD, "9.9.9.8", null)).ok).toBe(true);
  });
});

describe("setup", () => {
  it("needs the code, creates the admin once and then closes", async () => {
    const auth = service();
    expect(auth.setupRequired()).toBe(true);
    auth.setSetupCode("aaaa-bbbb");
    expect(await auth.setup("wrong", "root", PASSWORD, "1.1.1.1", null)).toEqual({ ok: false, error: "bad-code" });
    expect(await auth.setup("aaaa-bbbb", "x", PASSWORD, "1.1.1.1", null)).toMatchObject({ error: "invalid" });
    const r = await auth.setup(" aaaa-bbbb ", "root", PASSWORD, "1.1.1.1", null);
    expect(r.ok && r.value.user).toMatchObject({ username: "root", role: "admin" });
    expect(auth.setupRequired()).toBe(false);
    expect(await auth.setup("aaaa-bbbb", "root2", PASSWORD, "1.1.1.1", null)).toEqual({ ok: false, error: "bad-code" });
  });

  it("throttles setup attempts per IP", async () => {
    const auth = service();
    auth.setSetupCode("code");
    for (let i = 0; i < 10; i++) await auth.setup("bad", "root", PASSWORD, "5.5.5.5", null);
    expect(await auth.setup("code", "root", PASSWORD, "5.5.5.5", null)).toMatchObject({ error: "throttled" });
  });

  it("init reuses the stored JWT key and only prints a code with no users", () => {
    const store = new AccountsStore(openMemoryDb());
    const a = AuthService.init(store, {});
    expect(a.setupRequired()).toBe(true);
    const key = store.metaGetOrCreate("jwt_secret", () => "new");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(() => AuthService.init(store, { PXLS_JWT_SECRET: "short" })).toThrow(/at least 32/);
  });
});

describe("passwords", () => {
  it("changes your own password, revoking every session", async () => {
    const auth = await withUser();
    const t = await auth.login("bob", PASSWORD, "1.1.1.1", null);
    if (!t.ok) throw new Error();
    const user = t.value.user;
    expect(await auth.changePassword(user, "wrong", "another long passphrase", "1.1.1.1")).toEqual({ ok: false, error: "wrong-current" });
    expect(await auth.changePassword(user, PASSWORD, "short", "1.1.1.1")).toMatchObject({ error: "invalid" });
    expect((await auth.changePassword(user, PASSWORD, "another long passphrase", "1.1.1.1")).ok).toBe(true);
    expect(await auth.authenticate(t.value.accessToken)).toBeNull();
    expect((await auth.login("bob", "another long passphrase", "1.1.1.1", null)).ok).toBe(true);
  });
});
