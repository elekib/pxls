import { redirect } from "next/navigation";
import { LoginForm, SetupForm } from "@/components/auth/AuthForms";
import { getAuth } from "@/lib/auth";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if (await currentUser()) redirect("/");
  const setupRequired = getAuth().setupRequired();
  const { changed } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pxls-logo.svg" alt="pxls" className="mx-auto mb-8 h-14" />
        <div className="card">
          <h1 className="mb-4 text-lg font-semibold">{setupRequired ? "Create the admin account" : "Sign in"}</h1>
          {setupRequired ? <SetupForm /> : <LoginForm notice={changed ? "Password changed. Sign in again." : undefined} />}
        </div>
      </div>
    </main>
  );
}
