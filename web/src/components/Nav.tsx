"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/actions/auth";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export function Nav({ items, username, role, version }: { items: NavItem[]; username: string; role: string; version: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-gray-700 bg-gray-800">
      <div className="flex items-center justify-between border-b border-gray-700 p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pxls-logo.svg" alt="pxls" className="h-10" />
        <button className="p-2 text-gray-400 hover:text-white md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          ✕
        </button>
      </div>
      <nav className="flex-1 py-4">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setOpen(false)}
            className={`flex items-center px-6 py-3 text-base transition ${
              active(i.href) ? "border-r-4 border-cyan-400 bg-cyan-600 text-white" : "text-gray-300 hover:bg-gray-700 hover:text-white"
            }`}
          >
            <span className="mr-3 text-xl">{i.icon}</span>
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-3 border-t border-gray-700 p-4 text-sm">
        <div>
          <div className="font-medium text-gray-200">{username}</div>
          <div className="text-xs text-gray-500">{role}</div>
        </div>
        <form action={logout}>
          <button className="btn w-full">Sign out</button>
        </form>
        <div className="text-xs text-gray-600">pxls {version}</div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-3 md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pxls-logo.svg" alt="pxls" className="h-7" />
        <button className="btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
      </div>
      <div className="fixed inset-y-0 left-0 z-20 hidden md:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          {sidebar}
          <button className="flex-1 bg-black/50" onClick={() => setOpen(false)} aria-label="Close menu" />
        </div>
      )}
    </>
  );
}
