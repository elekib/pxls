"use server";

// Device page actions (admin only).

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { connectDevice, disconnectDevice, saveDeviceConfig, saveTimezone, type Outcome } from "@/lib/device/service";
import type { FormState } from "./auth";

const state = (r: Outcome): FormState => (r.ok ? { message: r.message } : { error: r.error });

export async function connect(_: FormState, form: FormData): Promise<FormState> {
  await requireUser("admin");
  const r = await connectDevice(String(form.get("mac") ?? ""));
  revalidatePath("/");
  return state(r);
}

export async function disconnect(): Promise<FormState> {
  await requireUser("admin");
  const r = await disconnectDevice();
  revalidatePath("/");
  return state(r);
}

/** `dc` comes from the browser; saveDeviceConfig validates and clamps it. */
export async function saveDevice(dc: unknown): Promise<FormState> {
  await requireUser("admin");
  const r = await saveDeviceConfig(dc);
  revalidatePath("/");
  return state(r);
}

export async function setTimezone(_: FormState, form: FormData): Promise<FormState> {
  await requireUser("admin");
  return state(saveTimezone(String(form.get("timezone") ?? "")));
}
