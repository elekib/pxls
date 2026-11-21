import { MdAutorenew } from "react-icons/md";

/** One loading state for the whole app: a spinner and a short label. */
export function Loading({ label = "Loading…", className = "py-8" }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 text-sm text-muted ${className}`}>
      <MdAutorenew className="h-5 w-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
