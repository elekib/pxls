import type { FormState } from "@/app/actions/auth";

export function Alert({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">{state.error}</p>;
  if (state.message) return <p className="rounded-lg border border-cyan-800 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-100">{state.message}</p>;
  return null;
}
