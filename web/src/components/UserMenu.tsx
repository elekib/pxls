"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MdExpandMore, MdLogout } from "react-icons/md";
import { logout } from "@/app/actions/auth";
import { TABS } from "./nav";
import { ThemeToggle } from "./ThemeToggle";

/** The signed-in user's menu: account, users (admins), theme and sign out. */
export function UserMenu({ username, role, version }: { username: string; role: string; version: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface2";
  const links = TABS.filter((t) => t.menu && (!t.admin || role === "admin"));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm font-medium text-ink hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-bold uppercase text-accent-ink" aria-hidden>
          {username.slice(0, 1)}
        </span>
        <span className="hidden max-w-[8rem] truncate sm:inline">{username}</span>
        <MdExpandMore className="h-4 w-4 text-muted" aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-line bg-surface p-2 shadow-lg">
          <div className="px-3 py-2">
            <div className="truncate font-semibold">{username}</div>
            <div className="text-xs text-muted">{role === "admin" ? "Administrator" : "Viewer (read-only)"}</div>
          </div>
          <div className="my-1 border-t border-line" />
          {links.map((t) => (
            <Link key={t.href} href={t.href} role="menuitem" className={`${item} text-ink`} onClick={() => setOpen(false)}>
              <t.icon className="h-5 w-5 text-muted" aria-hidden />
              {t.label}
            </Link>
          ))}
          <div className="px-3 py-2">
            <div className="mb-1 text-xs text-muted">Theme</div>
            <ThemeToggle />
          </div>
          <div className="my-1 border-t border-line" />
          <form action={logout}>
            <button role="menuitem" className={`${item} text-bad`}>
              <MdLogout className="h-5 w-5" aria-hidden />
              Sign out
            </button>
          </form>
          <div className="px-3 pt-1 text-xs text-muted">pxls {version}</div>
        </div>
      )}
    </div>
  );
}
