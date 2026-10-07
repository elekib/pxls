"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { TABS, isActive } from "./nav";

interface SidebarProps {
  mac: string;
  connected: boolean;
  username: string;
  role: string;
  version: string;
  onClose?: () => void;
}

export function Sidebar({ mac, connected, username, role, version, onClose }: SidebarProps) {
  const path = usePathname();
  const isAdmin = role === "admin";

  return (
    <aside className="w-64 h-full bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-6 border-b border-gray-700 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pxls-logo.svg" alt="pxls" className="max-w-full h-auto max-h-[70px]" />
        {onClose && (
          <button onClick={onClose} className="md:hidden p-2 text-gray-400 hover:text-white" aria-label="Close menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <nav className="flex-1 py-4 overflow-y-auto">
        {TABS.filter((t) => !t.admin || isAdmin).map((t) => (
          <Link
            key={t.href}
            href={t.href}
            onClick={onClose}
            className={`flex items-center px-6 py-3 text-gray-300 bg-none border-none w-full cursor-pointer text-base transition-all duration-200 text-left hover:bg-gray-700 hover:text-white ${
              isActive(path, t.href) ? "bg-cyan-600 border-r-4 border-cyan-400 text-white" : ""
            }`}
          >
            <span className="text-xl mr-3">{t.icon}</span>
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-700">
        <div className="bg-gray-900 rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400 text-xs">Status</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${connected ? "bg-green-600" : "bg-gray-600"}`}>
              {connected ? "Connected" : "Offline"}
            </span>
          </div>
          <code className="text-cyan-400 font-mono text-xs break-all">{mac || "Not set"}</code>
        </div>
        <div className="mt-3 text-xs text-gray-400 text-center">
          Signed in as <span className="text-gray-200">{username}</span> ({role})
        </div>
        <form action={logout}>
          <button className="mt-2 w-full py-2 text-sm text-gray-400 hover:text-white bg-gray-900 rounded-lg border border-gray-700">
            Sign out
          </button>
        </form>
        <div className="mt-3 text-center text-xs text-gray-500">pxls {version}</div>
      </div>
    </aside>
  );
}
