// Ported from the original Vite UI (frontend/src on main) as-is.

/** Copy of `items` sorted alphabetically by `label`, ignoring case and accents. */
export function sortAlpha<T>(items: readonly T[], label: (item: T) => string): T[] {
  return [...items].sort((a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base', numeric: true }));
}
