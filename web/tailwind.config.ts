import type { Config } from "tailwindcss";

// Colours are the CSS custom properties in globals.css, so one class works in
// light and dark (the tokens swap, utilities do not need `dark:` variants).
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--page)",
        surface: "var(--surface)",
        surface2: "var(--surface-2)",
        ink: "var(--ink)",
        ink2: "var(--ink-2)",
        muted: "var(--muted)",
        line: "var(--line)",
        axis: "var(--axis)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        good: "var(--good)",
        "good-ink": "var(--good-ink)",
        "good-soft": "var(--good-soft)",
        bad: "var(--bad)",
        "bad-ink": "var(--bad-ink)",
        "bad-soft": "var(--bad-soft)",
        warn: "var(--warn)",
        "warn-ink": "var(--warn-ink)",
        "warn-soft": "var(--warn-soft)",
        info: "var(--info)",
        "info-ink": "var(--info-ink)",
        "info-soft": "var(--info-soft)",
        violet: "var(--violet)",
        "violet-ink": "var(--violet-ink)",
        "violet-soft": "var(--violet-soft)",
      },
      boxShadow: { card: "var(--shadow)" },
      fontFamily: { sans: ["system-ui", "-apple-system", '"Segoe UI"', "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
