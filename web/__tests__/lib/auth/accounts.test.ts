import { describe, expect, it } from "vitest";
import { Accounts } from "@/lib/auth/accounts";
import { createAuth, verifyPassword } from "@/lib/auth/auth";
import { openMemoryDb } from "@/lib/db/sqlite";

const PW = "correct horse battery";
const ORIGIN = "http://localhost:3030";

function make() {
  const db = openMemoryDb();
  const auth = createAuth(db, { nextCookies: false, env: {} });
  const accounts = new Accounts(auth, db);
  return { db, auth, accounts };
}

async function seeded() {
  const t = make();
  t.accounts.setSetupCode("abcd-1234");
  await t.accounts.setup("abcd-1234", "Aakib", PW);
  return t;
}

const signIn = (auth: ReturnType<typeof make>["auth"], username: string, password: string, ip = "203.0.113.7") =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/username`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-pxls-ip": ip },
      body: JSON.stringify({ username, password }),
    }),
  );

describe("setup", () => {
  it("creates the first admin with the code, once", async () => {
    const { accounts } = make();
    accounts.setSetupCode("abcd-1234");
    expect(accounts.setupRequired()).toBe(true);
    expect(await accounts.setup("wrong", "aakib", PW)).toMatchObject({ ok: false, error: "bad-code" });
    expect(await accounts.setup("abcd-1234", "ab", PW)).toMatchObject({ ok: false, error: "invalid" });
    expect(await accounts.setup(" abcd-1234 ", "Aakib", PW)).toEqual({ ok: true });
    expect(accounts.setupRequired()).toBe(false);
    expect(await accounts.setup("abcd-1234", "other", PW)).toMatchObject({ ok: false, error: "bad-code" });
    const [admin] = await accounts.listUsers();
    expect(admin).toMatchObject({ username: "Aakib", role: "admin", disabled: false });
  });

  it("keeps the code usable after a failed attempt", async () => {
    const { accounts } = make();
    accounts.setSetupCode("abcd-1234");
    await accounts.setup("abcd-1234", "x!", PW);
    expect(await accounts.setup("abcd-1234", "aakib", PW)).toEqual({ ok: true });
  });
});

describe("sign-in", () => {
  it("signs in by username, any case, and returns a bearer token", async () => {
    const { auth } = await seeded();
    const res = await signIn(auth, "AAKIB", PW);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/pxls\.session_token=.*HttpOnly.*SameSite=Strict/i);
    const token = res.headers.get("set-auth-token")!;
    const s = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
    expect(s?.user.role).toBe("admin");
  });

  it("rejects a wrong password and an unknown user alike", async () => {
    const { auth } = await seeded();
    expect((await signIn(auth, "aakib", "wrong-wrong-wrong")).status).toBe(401);
    expect((await signIn(auth, "ghost", PW)).status).toBe(401);
  });

  it("rate-limits repeated failures per address", async () => {
    const { auth } = await seeded();
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await signIn(auth, "aakib", "wrong-wrong-wrong", "198.51.100.1")).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429, 429]);
    // another address is unaffected
    expect((await signIn(auth, "aakib", PW, "198.51.100.2")).status).toBe(200);
  });

  it("stores argon2id hashes", async () => {
    const { db } = await seeded();
    const row = db.prepare("SELECT password FROM account").get() as { password: string };
    expect(row.password).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(row.password, PW)).toBe(true);
  });
});

describe("users", () => {
  it("creates viewers, rejects duplicates ignoring case, and validates input", async () => {
    const { accounts } = await seeded();
    expect(await accounts.createUser("viewer1", PW, "viewer")).toMatchObject({ ok: true, user: { role: "viewer" } });
    expect(await accounts.createUser("VIEWER1", PW, "viewer")).toMatchObject({ ok: false, error: "duplicate" });
    expect(await accounts.createUser("aakib", PW, "viewer")).toMatchObject({ ok: false, error: "duplicate" });
    expect(await accounts.createUser("v", PW, "viewer")).toMatchObject({ ok: false });
    expect(await accounts.createUser("viewer2", "short", "viewer")).toMatchObject({ ok: false });
  });

  it("keeps the last enabled admin", async () => {
    const { accounts } = await seeded();
    const [admin] = await accounts.listUsers();
    expect(await accounts.updateUser(admin!.id, { role: "viewer" })).toBe("last-admin");
    expect(await accounts.updateUser(admin!.id, { disabled: true })).toBe("last-admin");
    expect(await accounts.deleteUser(admin!.id)).toBe("last-admin");
    const second = await accounts.createUser("second", PW, "admin");
    if (!second.ok) throw new Error("create failed");
    expect(await accounts.updateUser(admin!.id, { role: "viewer" })).toMatchObject({ role: "viewer" });
    expect(await accounts.deleteUser(second.user.id)).toBe("last-admin");
    expect(await accounts.updateUser("nope", { role: "admin" })).toBe("not-found");
  });

  it("disabling a user ends their sessions and blocks sign-in", async () => {
    const { accounts, auth } = await seeded();
    const v = await accounts.createUser("viewer1", PW, "viewer");
    if (!v.ok) throw new Error("create failed");
    expect((await signIn(auth, "viewer1", PW, "198.51.100.3")).status).toBe(200);
    expect(await accounts.listSessions(v.user.id)).toHaveLength(1);
    expect(await accounts.updateUser(v.user.id, { disabled: true })).toMatchObject({ disabled: true });
    expect(await accounts.listSessions(v.user.id)).toHaveLength(0);
    expect((await signIn(auth, "viewer1", PW, "198.51.100.3")).status).toBeGreaterThanOrEqual(400);
    await accounts.updateUser(v.user.id, { disabled: false });
    expect((await signIn(auth, "viewer1", PW, "198.51.100.3")).status).toBe(200);
  });

  it("an admin password reset ends the user's sessions and the new password works", async () => {
    const { accounts, auth } = await seeded();
    const v = await accounts.createUser("viewer1", PW, "viewer");
    if (!v.ok) throw new Error("create failed");
    await signIn(auth, "viewer1", PW, "198.51.100.4");
    expect(await accounts.setPassword(v.user, "short")).toMatchObject({ ok: false });
    expect(await accounts.setPassword(v.user, "a brand new password")).toEqual({ ok: true });
    expect(await accounts.listSessions(v.user.id)).toHaveLength(0);
    expect((await signIn(auth, "viewer1", PW, "198.51.100.4")).status).toBe(401);
    expect((await signIn(auth, "viewer1", "a brand new password", "198.51.100.4")).status).toBe(200);
  });

  it("deleting a user removes their sessions", async () => {
    const { accounts, auth } = await seeded();
    const v = await accounts.createUser("viewer1", PW, "viewer");
    if (!v.ok) throw new Error("create failed");
    await signIn(auth, "viewer1", PW, "198.51.100.5");
    expect(await accounts.deleteUser(v.user.id)).toBe(true);
    expect(await accounts.getUser(v.user.id)).toBeNull();
    expect(await accounts.listSessions(v.user.id)).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("lists a user's sessions and revokes only their own", async () => {
    const { accounts, auth } = await seeded();
    const v = await accounts.createUser("viewer1", PW, "viewer");
    if (!v.ok) throw new Error("create failed");
    await signIn(auth, "aakib", PW, "198.51.100.6");
    await signIn(auth, "viewer1", PW, "198.51.100.7");
    const [admin] = (await accounts.listUsers()).filter((u) => u.role === "admin");
    const [mine] = await accounts.listSessions(admin!.id);
    expect(mine).toMatchObject({ ip: "198.51.100.6" });
    expect(await accounts.revokeSession(v.user.id, mine!.id)).toBe(false);
    expect(await accounts.revokeSession(admin!.id, mine!.id)).toBe(true);
    expect(await accounts.listSessions(admin!.id)).toHaveLength(0);
    expect(await accounts.revokeUserSessions(v.user.id)).toBe(1);
  });
});
