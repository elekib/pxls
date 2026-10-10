// Small helpers shared by the auth code and the webhook receiver.

import { randomBytes, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD_LEN = 12;
export const MAX_PASSWORD_LEN = 128;
export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 32;

/** Compare without short-circuiting on the first difference. */
export function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

export function validateUsername(username: string): string | null {
  const n = [...username].length;
  if (n < MIN_USERNAME_LEN || n > MAX_USERNAME_LEN) {
    return `Username must be ${MIN_USERNAME_LEN} to ${MAX_USERNAME_LEN} characters`;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    return "Username may only contain letters, numbers, '.', '_' and '-'";
  }
  return null;
}

export function validatePassword(password: string, username: string): string | null {
  const n = [...password].length;
  if (n < MIN_PASSWORD_LEN) return `Password must be at least ${MIN_PASSWORD_LEN} characters`;
  if (n > MAX_PASSWORD_LEN) return `Password must be at most ${MAX_PASSWORD_LEN} characters`;
  if (password.toLowerCase() === username.toLowerCase()) return "Password must not be the same as the username";
  return null;
}

/** 24 hex characters in groups of four. */
export const formatSetupCode = () => randomBytes(12).toString("hex").match(/.{4}/g)!.join("-");
