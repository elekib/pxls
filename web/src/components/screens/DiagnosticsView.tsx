"use client";

import { DeviceTester } from "@/components/DeviceTester";
import { useToast } from "@/components/Toast";
import { DiagnosticsPage } from "./DiagnosticsPage";

/** The original Diagnostics page, plus this branch's quick tests. */
export function DiagnosticsView({ enabled }: { enabled: boolean }) {
  const notify = useToast();
  return (
    <div className="space-y-6">
      <DiagnosticsPage onNotify={notify} />
      {enabled && (
        <div className="max-w-3xl">
          <DeviceTester />
        </div>
      )}
    </div>
  );
}
