"use client";

// The original UI's notification banner (top right, 3 s), as a context.

import { createContext, useCallback, useContext, useRef, useState } from "react";

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

  return (
    <ToastContext.Provider value={notify}>
      {notification && (
        <div
          className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-[100] font-medium max-w-[90vw] md:max-w-[400px] ${
            notification.type === "success" ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {notification.message}
        </div>
      )}
      {children}
    </ToastContext.Provider>
  );
}
