"use client";

import { useState } from "react";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";

interface ShellProps {
  mac: string;
  connected: boolean;
  username: string;
  role: string;
  version: string;
  children: React.ReactNode;
}

/** The app layout: sidebar, mobile drawer and bottom tabs. */
export function AppShell({ children, ...user }: ShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden md:block">
          <Sidebar {...user} />
        </div>

        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Mobile Sidebar Drawer */}
        <div
          className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 md:hidden ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar {...user} onClose={() => setSidebarOpen(false)} />
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20 md:pb-8">
          {/* Mobile Header */}
          <div className="md:hidden flex items-center gap-3 mb-4">
            <button onClick={() => setSidebarOpen(true)} className="p-2 bg-gray-800 rounded-lg border border-gray-700" aria-label="Open menu">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pxls-logo.svg" alt="pxls" className="h-8 w-auto" />
          </div>
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <MobileNav isAdmin={user.role === "admin"} />
      </div>
    </ToastProvider>
  );
}
