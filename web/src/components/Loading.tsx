import { MdAutorenew } from "react-icons/md";

/** One loading state for the whole app: a spinner and a short label. `inline` is the small version for use beside a control. */
export function Loading({ label = "Loading…", inline = false, className = "" }: { label?: string; inline?: boolean; className?: string }) {
  return (
    <div
      role="status"
      className={`flex items-center text-muted ${inline ? "gap-2 text-sm" : "justify-center gap-3 py-16 text-base"} ${className}`}
    >
      <MdAutorenew className={`animate-spin ${inline ? "h-4 w-4" : "h-8 w-8"}`} aria-hidden />
      {label}
    </div>
  );
}
