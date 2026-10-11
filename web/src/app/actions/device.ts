"use server";

// Device page actions. Viewers get a read-only message.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/session";
import { applyBrightness, applyScores, connectDevice, disconnectDevice, saveDeviceConfig, saveTimezone, type Outcome } from "@/lib/device/service";
import type { FormState } from "./auth";

const READ_ONLY = { error: "Your account is read-only. Ask an admin for changes." };

async function asAdmin(fn: () => Promise<Outcome> | Outcome): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { error: "Your session expired. Please sign in again." };
  if (me.user.role !== "admin") return READ_ONLY;
  const r = await fn();
  revalidatePath("/", "layout");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function connect(mac: string): Promise<FormState> {
  return asAdmin(() => connectDevice(typeof mac === "string" ? mac : ""));
}

export async function disconnect(): Promise<FormState> {
  return asAdmin(() => disconnectDevice());
}

/** `dc` comes from the browser; saveDeviceConfig validates and clamps it. */
export async function saveDevice(dc: unknown): Promise<FormState> {
  return asAdmin(() => saveDeviceConfig(dc));
}

/** Live brightness from the slider: applied right away and saved. */
export async function setBrightness(percent: number): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { error: "Your session expired. Please sign in again." };
  if (me.user.role !== "admin") return READ_ONLY;
  // No revalidate: the slider owns its state, and re-rendering mid-drag is jumpy.
  const r = await applyBrightness(typeof percent === "number" ? percent : NaN);
  return r.ok ? { message: r.message } : { error: r.error };
}

/** Live scores from the Score mode controls: saved, and shown if Score mode is on. */
export async function setScores(red: number, blue: number): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { error: "Your session expired. Please sign in again." };
  if (me.user.role !== "admin") return READ_ONLY;
  const r = await applyScores(Number(red), Number(blue));
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function setTimezone(tz: string): Promise<FormState> {
  return asAdmin(() => saveTimezone(typeof tz === "string" ? tz : ""));
}
