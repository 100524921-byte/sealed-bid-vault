import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { formatClose, useNow } from "@/lib/time";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Procesos — BidVault" },
      { name: "description", content: "Procesos de ofertas selladas abiertos y cerrados." },
      { property: "og:title", content: "Procesos — BidVault" },
      { property: "og:description", content: "Procesos de ofertas selladas." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: me } = useMe();
  const now = useNow();
  const { data: processes, isLoading } = useQuery({
    queryKey: ["processes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processes")
        .select("id, title, asset_type, closes_at, organizer_id, profiles(display_name, organization)")
        .order("closes_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const isOrganizer = me?.roles.includes("organizer");
  const needsKey = me?.roles.includes("bidder") && !me.profile?.key_fingerprint;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Sala de ofertas</p>
          <h1 className="mt-2 text-4xl">Procesos</h1>
        </div>
        {isOrganizer && (
          <Button asChild>
            <Link to="/processes/new">
              <Plus className="h-4 w-4" /> Nuevo proceso
            </Link>
          </Button>
        )}
      </div>

      {needsKey && (
        <div className="rounded-lg border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
          Antes de ofertar necesitas una clave de firma.{" "}
          <Link to="/keys" className="underline">
            Generarla ahora
          </Link>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !processes?.length ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Aún no hay procesos. {isOrganizer ? "Crea el primero." : "Cuando un organizador abra uno, aparecerá aquí."}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {processes.map((p) => {
            const open = new Date(p.closes_at).getTime() > now;
            return (
              <li key={p.id}>
                <Link
                  to="/processes/$id"
                  params={{ id: p.id }}
                  className="block rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="eyebrow">{p.asset_type}</p>
                      <h2 className="mt-1 text-2xl leading-tight">{p.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.profiles?.organization || p.profiles?.display_name}
                      </p>
                    </div>
                    <StatusPill open={open} />
                  </div>
                  <p className="mt-4 font-mono text-xs text-muted-foreground">{formatClose(p.closes_at, now)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
