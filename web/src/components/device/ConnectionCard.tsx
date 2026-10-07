"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/app/actions/auth";
import { connect, disconnect } from "@/app/actions/device";
import { Alert } from "@/components/Alert";

export function ConnectionControls({ mac, connected }: { mac: string; connected: boolean }) {
  const [state, action, pending] = useActionState(connect, {});
  const [dState, setDState] = useState<FormState>({});
  const [dPending, start] = useTransition();

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="mac">MAC address</label>
          <input
            className="input font-mono"
            id="mac"
            name="mac"
            defaultValue={mac}
            placeholder="AA:BB:CC:DD:EE:FF"
            pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"
            required
          />
        </div>
        <button className="btn-primary" disabled={pending}>{pending ? "Connecting…" : "Connect"}</button>
        {connected && (
          <button type="button" className="btn" disabled={dPending} onClick={() => start(async () => setDState(await disconnect()))}>
            Disconnect
          </button>
        )}
      </form>
      <Alert state={state.error || state.message ? state : dState} />
    </div>
  );
}
