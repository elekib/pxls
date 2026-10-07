import { Pending } from "@/components/screens/Pending";
import { requireUser } from "@/lib/auth/session";

export default async function Page() {
  await requireUser();
  return <Pending title="Tools" phase={4} />;
}
