"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, isActive } from "./nav";

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 md:hidden z-30">
      <div className="flex">
        {TABS.filter((t) => t.mobile && (!t.admin || isAdmin)).map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`flex-1 flex flex-col items-center py-3 px-4 transition-all ${
              isActive(path, t.href) ? "text-cyan-400 bg-gray-700/50" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <span className="text-xl mb-1">{t.icon}</span>
            <span className="text-xs font-medium">{t.short}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
