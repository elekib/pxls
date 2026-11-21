"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MdBluetoothConnected, MdBluetoothDisabled } from "react-icons/md";
import { TABS, isActive } from "./nav";
import { UserMenu } from "./UserMenu";

interface Props {
  mac: string;
  connected: boolean;
  username: string;
  role: string;
  version: string;
}

const pill = (active: boolean) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
    active ? "bg-accent text-accent-ink" : "text-ink2 hover:bg-surface2 hover:text-ink"
  }`;

/** Top bar: brand, sections, device status and the user menu. */
export function NavBar({ mac, connected, username, role, version }: Props) {
  const path = usePathname();
  const tabs = TABS.filter((t) => !t.menu && (!t.admin || role === "admin"));

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--page)_90%,transparent)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-ink" aria-label="pxls home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pxls-logo.svg" alt="pxls" className="h-8 w-auto rounded-md" />
        </Link>

        <nav aria-label="Sections" className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex">
          {tabs.map((t) => {
            const active = isActive(path, t.href);
            return (
              <Link key={t.href} href={t.href} className={pill(active)} aria-current={active ? "page" : undefined}>
                <t.icon className="h-4 w-4" aria-hidden />
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <span
            title={mac ? `Pixoo ${mac}` : "No device set"}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-good-soft text-good" : "bg-surface2 text-muted"}`}
          >
            {connected ? <MdBluetoothConnected className="h-4 w-4" aria-hidden /> : <MdBluetoothDisabled className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{connected ? "Connected" : "Offline"}</span>
            <span className="sr-only sm:hidden">{connected ? "Connected" : "Offline"}</span>
          </span>
          <UserMenu username={username} role={role} version={version} />
        </div>
      </div>
    </header>
  );
}
