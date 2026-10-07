import { Nav, type NavItem } from "@/components/Nav";
import { requireUser } from "@/lib/auth/session";
import { revision, version } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const items: NavItem[] = [
    { href: "/", label: "Device", icon: "📱" },
    { href: "/account", label: "Account", icon: "👤" },
    ...(user.role === "admin" ? [{ href: "/users", label: "Users", icon: "👥" }] : []),
  ];
  const sha = revision();
  return (
    <div className="min-h-screen">
      <Nav items={items} username={user.username} role={user.role} version={sha === "unknown" ? version() : `${version()} (${sha.slice(0, 7)})`} />
      <main className="px-4 py-6 md:ml-64 md:px-8 md:py-8">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
