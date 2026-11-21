"use client";

import { MobileNav } from "./MobileNav";
import { NavBar } from "./NavBar";
import { ToastProvider } from "./Toast";

interface ShellProps {
  mac: string;
  connected: boolean;
  username: string;
  role: string;
  version: string;
  children: React.ReactNode;
}

/** The app layout: top bar, page content and bottom tabs on phones. */
export function AppShell({ children, ...user }: ShellProps) {
  return (
    <ToastProvider>
      <NavBar {...user} />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 md:pb-8">{children}</main>
      <MobileNav isAdmin={user.role === "admin"} />
    </ToastProvider>
  );
}
