"use client";

import { useEffect, useState } from "react";

type Choice = "auto" | "light" | "dark";
const KEY = "pxls-theme";
const OPTIONS: { value: Choice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Auto follows the system; Light and Dark are remembered in this browser. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("auto");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setChoice(saved);
    } catch {
      /* storage unavailable: stay on Auto */
    }
  }, []);

  const pick = (value: Choice) => {
    setChoice(value);
    apply(value);
    try {
      if (value === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      /* not remembered, still applied for this visit */
    }
  };

  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-full border border-line bg-surface2 p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          onClick={() => pick(o.value)}
          className={`rounded-full px-3 py-0.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            choice === o.value ? "bg-ink text-surface" : "text-ink2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
