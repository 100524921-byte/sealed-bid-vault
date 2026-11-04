import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { roleLabel, useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-brass text-primary-foreground shadow-seal">
        <ShieldCheck className="h-4 w-4" />
      </span>
      <span className="font-display text-2xl leading-none">BidVault</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const isAuditor = me?.roles.includes("auditor");
  const linkCls = "text-sm text-muted-foreground transition-colors hover:text-foreground";
  const active = { className: "text-sm text-foreground" };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-background/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Logo />
          <nav className="flex items-center gap-4">
            <Link to="/dashboard" className={linkCls} activeProps={active}>
              Procesos
            </Link>
            <Link to="/keys" className={linkCls} activeProps={active}>
              Mis claves
            </Link>
            {isAuditor && (
              <Link to="/audit" className={linkCls} activeProps={active}>
                Auditoría
              </Link>
            )}
            {me && (
              <span className="hidden rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent-foreground sm:inline">
                {me.roles.map((r) => roleLabel[r]).join(" · ")}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cerrar sesión"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/auth" });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
