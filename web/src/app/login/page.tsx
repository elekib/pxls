import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/screens/LoginScreen";
import { SetupScreen } from "@/components/screens/SetupScreen";
import { getAccounts } from "@/lib/auth";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if (await currentUser()) redirect("/");
  if (getAccounts().setupRequired()) return <SetupScreen />;
  const { changed } = await searchParams;
  return <LoginScreen notice={changed ? "Password changed. Sign in again with the new password." : null} />;
}
