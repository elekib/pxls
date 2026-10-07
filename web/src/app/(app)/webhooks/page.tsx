import { Pending } from "@/components/screens/Pending";
import { requireUser } from "@/lib/auth/session";

export default async function Page() {
  await requireUser("admin");
  return <Pending title="Webhooks" phase={5} />;
}
