import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Auditoría — BidVault" },
      { name: "description", content: "Registro de eventos criptográficos de todos los procesos." },
      { property: "og:title", content: "Auditoría — BidVault" },
      { property: "og:description", content: "Registro de auditoría de BidVault." },
    ],
  }),
  component: AuditPage,
});

const labels: Record<string, string> = {
  "key.registered": "Clave registrada",
  "key.rotated": "Clave rotada",
  "process.created": "Proceso creado",
  "bid.sealed": "Oferta sellada",
  "bid.rejected": "Oferta rechazada",
  "reveal.denied": "Apertura denegada",
  "process.revealed": "Ofertas abiertas",
};

function AuditPage() {
  const { data } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const { data: rows } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
      const ids = [...new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, display_name").in("id", ids)
        : { data: [] };
      const name = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
      return (rows ?? []).map((r) => ({ ...r, actor: name.get(r.actor_id ?? "") ?? "—" }));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Auditor</p>
        <h1 className="mt-2 text-4xl">Registro de auditoría</h1>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {data?.map((r) => (
          <li key={r.id} className="space-y-1 p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <span className="text-primary">{labels[r.action] ?? r.action}</span> · {r.actor}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("es-ES")}
              </span>
            </div>
            <p className="font-mono text-[11px] break-all text-muted-foreground">{JSON.stringify(r.details)}</p>
          </li>
        ))}
        {data?.length === 0 && <li className="p-4 text-sm text-muted-foreground">Sin eventos.</li>}
      </ul>
    </div>
  );
}
