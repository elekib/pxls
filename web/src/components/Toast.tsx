"use client";

// The notification banner (top right, 3 s), as a context.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { MdCheckCircle, MdError } from "react-icons/md";
import { FORBIDDEN_EVENT } from "@/ui/api";

type Notify = (message: string, type?: "success" | "error") => void;

const ToastContext = createContext<Notify>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback<Notify>((message, type = "success") => {
    setNotification({ message, type });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  useEffect(() => {
    const onForbidden = () => notify("Your account is read-only. Ask an admin for changes.", "error");
    window.addEventListener(FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(FORBIDDEN_EVENT, onForbidden);
  }, [notify]);

  return (
    <ToastContext.Provider value={notify}>
      {notification && (
        <div
          role="status"
          className={`fixed right-4 top-4 z-[100] flex max-w-[90vw] items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg md:max-w-[400px] ${
            notification.type === "success" ? "bg-good text-good-ink" : "bg-bad text-bad-ink"
          }`}
        >
          {notification.type === "success" ? <MdCheckCircle className="h-5 w-5 shrink-0" aria-hidden /> : <MdError className="h-5 w-5 shrink-0" aria-hidden />}
          {notification.message}
        </div>
      )}
      {children}
    </ToastContext.Provider>
  );
}
