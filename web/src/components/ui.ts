// Shared Tailwind class strings, so forms and buttons look the same everywhere.
// Same set as Barkat; colours are theme tokens, so they follow light and dark.

export const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const input = `w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted hover:border-axis ${focus}`;

export const btn = `inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

export const btnGhost = `inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-transparent px-3 py-1.5 text-sm font-medium text-accent transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

export const btnQuiet = `inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink2 transition hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

export const btnDanger = `inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-bad transition hover:border-bad disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

export const card = "rounded-2xl border border-line bg-surface shadow-card";
