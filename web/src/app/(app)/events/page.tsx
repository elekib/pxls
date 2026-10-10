import { WebhookEventsView } from "@/components/screens/WebhookViews";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  return <WebhookEventsView />;
}
