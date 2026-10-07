"use client";

import { useToast } from "@/components/Toast";
import { WebhookEventsPage } from "./WebhookEventsPage";
import { WebhooksPage } from "./WebhooksPage";

/** The ported webhook screens with the app's toasts. */
export function WebhooksView() {
  return <WebhooksPage onNotify={useToast()} />;
}

export function WebhookEventsView() {
  return <WebhookEventsPage onNotify={useToast()} />;
}
