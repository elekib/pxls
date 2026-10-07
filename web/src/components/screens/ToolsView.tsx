"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { Config } from "@/ui/types";
import { ToolsPage } from "./ToolsPage";

/** Hooks the ported ToolsPage up to the Next app: refresh and toasts. */
export function ToolsView({ config }: { config: Config }) {
  const router = useRouter();
  const notify = useToast();
  return <ToolsPage config={config} onConfigUpdate={() => router.refresh()} onNotify={notify} />;
}
