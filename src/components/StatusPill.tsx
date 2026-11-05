import { Lock, LockOpen } from "lucide-react";

export function StatusPill({ open }: { open: boolean }) {
  return open ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sealed/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-sealed">
      <Lock className="h-3 w-3" /> Sellado
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-success">
      <LockOpen className="h-3 w-3" /> Cerrado
    </span>
  );
}
