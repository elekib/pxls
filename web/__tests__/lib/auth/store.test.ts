import { describe, expect, it } from "vitest";
import { openMemoryDb } from "@/lib/db/sqlite";
import { AccountsStore } from "@/lib/auth/store";

const T = 1_000_000;
const store = () => new AccountsStore(openMemoryDb());

function session(s: AccountsStore, userId: number, id: string, hash: string, now = T) {
  s.createSession({ id, userId, refreshHash: hash, now, idleTtl: 100, absoluteTtl: 1000, userAgent: null, ip: "1.2.3.4" });
}

describe("AccountsStore", () => {
  it("creates the first admin only once", () => {
    const s = store();
    expect(s.createFirstAdmin("root", "h", T)).toMatchObject({ username: "root", role: "admin", disabled: false });
    expect(s.createFirstAdmin("other", "h", T)).toBeNull();
    expect(s.userCount()).toBe(1);
  });

  it("rejects duplicate usernames ignoring case", () => {
    const s = store();
    expect(s.createUser("Alice", "h", "viewer", T)).toMatchObject({ username: "Alice" });
    expect(s.createUser("alice", "h", "viewer", T)).toBe("duplicate");
    expect(s.findUserWithHash("ALICE")?.user.username).toBe("Alice");
  });

  it("keeps at least one enabled admin", () => {
    const s = store();
    const admin = s.createFirstAdmin("root", "h", T)!;
    expect(s.updateUser(admin.id, "viewer", undefined, T)).toBe("last-admin");
    expect(s.updateUser(admin.id, undefined, true, T)).toBe("last-admin");
    expect(s.deleteUser(admin.id)).toBe("last-admin");
    const second = s.createUser("second", "h", "admin", T) as { id: number };
    expect(s.updateUser(admin.id, undefined, true, T)).toMatchObject({ disabled: true });
    expect(s.deleteUser(second.id)).toBe("last-admin");
    expect(s.deleteUser(999)).toBe("not-found");
  });

  it("revokes sessions on password change, disable and role change", () => {
    const s = store();
    const u = s.createUser("bob", "h", "viewer", T) as { id: number };
    session(s, u.id, "s1", "a");
    expect(s.sessionUser("s1", u.id, T)).not.toBeNull();
    s.setPassword(u.id, "h2", T);
    expect(s.sessionUser("s1", u.id, T)).toBeNull();

    session(s, u.id, "s2", "b");
    s.updateUser(u.id, "admin", undefined, T);
    expect(s.sessionUser("s2", u.id, T)).toBeNull();
  });

  it("rotates refresh tokens and revokes on reuse", () => {
    const s = store();
    const u = s.createUser("bob", "h", "viewer", T) as { id: number };
    session(s, u.id, "s1", "old");
    expect(s.rotateSession("old", "new", T + 1, 100)).toEqual({ kind: "rotated", sessionId: "s1", userId: u.id });
    expect(s.rotateSession("old", "x", T + 2, 100)).toEqual({ kind: "reuse", sessionId: "s1", userId: u.id });
    expect(s.rotateSession("new", "y", T + 3, 100)).toEqual({ kind: "invalid" });
    expect(s.rotateSession("unknown", "z", T, 100)).toEqual({ kind: "invalid" });
  });

  it("expires idle sessions and caps sliding at the absolute expiry", () => {
    const s = store();
    const u = s.createUser("bob", "h", "viewer", T) as { id: number };
    session(s, u.id, "s1", "tok");
    expect(s.rotateSession("tok", "t2", T + 101, 100)).toEqual({ kind: "invalid" });

    session(s, u.id, "s2", "c1");
    let now = T;
    // Used every 90 s, it outlives the 100 s idle limit...
    for (let i = 0; i < 10; i++) {
      now += 90;
      expect(s.touchCookieSession("c1", now, 100)?.sessionId).toBe("s2");
    }
    // ...but never the 1000 s absolute limit.
    expect(s.touchCookieSession("c1", T + 990, 100)?.sessionId).toBe("s2");
    expect(s.touchCookieSession("c1", T + 1000, 100)).toBeNull();
  });

  it("does not resolve cookie sessions for disabled users or revoked sessions", () => {
    const s = store();
    s.createFirstAdmin("root", "h", T);
    const u = s.createUser("bob", "h", "viewer", T) as { id: number };
    session(s, u.id, "s1", "c1");
    expect(s.revokeSession(u.id, "s1", T, "logout")).toBe(true);
    expect(s.touchCookieSession("c1", T, 100)).toBeNull();
    session(s, u.id, "s2", "c2");
    s.updateUser(u.id, undefined, true, T);
    expect(s.touchCookieSession("c2", T, 100)).toBeNull();
  });

  it("locks after max failures inside the window and resets after it", () => {
    const s = store();
    for (let i = 1; i < 5; i++) expect(s.throttleFail("login-user", "bob", T + i, 5, 900, 900)).toBe(false);
    expect(s.throttleCheck("login-user", "bob", T + 5)).toBeNull();
    expect(s.throttleFail("login-user", "bob", T + 5, 5, 900, 900)).toBe(true);
    expect(s.throttleCheck("login-user", "bob", T + 6)).toBe(T + 905);
    expect(s.throttleCheck("login-user", "bob", T + 905)).toBeNull();
    s.throttleClear("login-user", "bob");
    expect(s.throttleFail("login-ip", "1.1.1.1", T, 5, 900, 900)).toBe(false);
    expect(s.throttleFail("login-ip", "1.1.1.1", T + 901, 2, 900, 900)).toBe(false);
  });

  it("creates meta values once", () => {
    const s = store();
    expect(s.metaGetOrCreate("k", () => "first")).toBe("first");
    expect(s.metaGetOrCreate("k", () => "second")).toBe("first");
  });
});
