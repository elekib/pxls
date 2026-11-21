"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, isActive } from "./nav";

/** Bottom tabs for phones. */
export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden">
      <ul className="flex">
        {TABS.filter((t) => t.mobile && (!t.admin || isAdmin)).map((t) => {
          const active = isActive(path, t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition ${active ? "text-accent" : "text-muted hover:text-ink"}`}
              >
                <t.icon className="h-6 w-6" aria-hidden />
                {t.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
