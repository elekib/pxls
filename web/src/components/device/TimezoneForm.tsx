"use client";

import { useActionState } from "react";
import { setTimezone } from "@/app/actions/device";
import { Alert } from "@/components/Alert";

export function TimezoneForm({ timezone, readOnly }: { timezone: string; readOnly: boolean }) {
  const [state, action, pending] = useActionState(setTimezone, {});
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="timezone">Timezone</label>
          <input className="input" id="timezone" name="timezone" list="timezones" defaultValue={timezone} disabled={readOnly} required />
          <datalist id="timezones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </div>
        {!readOnly && <button className="btn-primary" disabled={pending}>Save Timezone</button>}
      </div>
      <Alert state={state} />
    </form>
  );
}
