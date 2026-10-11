"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { Config } from "@/ui/types";
import { PagesPage } from "./PagesPage";

/** Hooks the PagesPage up to the Next app: refresh and toasts. */
export function PagesView({ config }: { config: Config }) {
  const router = useRouter();
  const notify = useToast();
  return <PagesPage config={config} onConfigUpdate={() => router.refresh()} onNotify={notify} />;
}
