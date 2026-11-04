import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { createProcess } from "@/lib/bidvault.functions";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/processes/new")({
  head: () => ({
    meta: [
      { title: "Nuevo proceso — BidVault" },
      { name: "description", content: "Crea un proceso de ofertas selladas con cierre automático." },
      { property: "og:title", content: "Nuevo proceso — BidVault" },
      { property: "og:description", content: "Crea un proceso de ofertas selladas." },
    ],
  }),
  component: NewProcess,
});

function defaultClose() {
  const d = new Date(Date.now() + 2 * 86400_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function NewProcess() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [closes] = useState(defaultClose);

  if (me && !me.roles.includes("organizer"))
    return <p className="text-sm text-muted-foreground">Solo los organizadores pueden crear procesos.</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const { id } = await createProcess({
        data: {
          title: String(f.get("title")),
          description: String(f.get("description")),
          assetType: String(f.get("assetType")),
          closesAt: new Date(String(f.get("closesAt"))).toISOString(),
        },
      });
      await qc.invalidateQueries({ queryKey: ["processes"] });
      toast.success("Proceso creado y clave de sellado generada");
      navigate({ to: "/processes/$id", params: { id } });
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="eyebrow">Organizador</p>
        <h1 className="mt-2 text-4xl">Nuevo proceso</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Al crearlo se genera un par de claves RSA-3072 exclusivo. Las ofertas se sellan con la parte pública; la privada queda custodiada y solo se libera tras el cierre.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" required minLength={3} placeholder="Venta del 100% de Acme Logística S.L." />
      </div>
      <div className="space-y-2">
        <Label htmlFor="assetType">Tipo</Label>
        <Input id="assetType" name="assetType" defaultValue="M&A" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Descripción</Label>
        <Textarea id="description" name="description" rows={5} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="closesAt">Cierre (hora local)</Label>
        <Input id="closesAt" name="closesAt" type="datetime-local" defaultValue={closes} required />
      </div>
      <Button disabled={busy}>{busy ? "Generando claves…" : "Crear proceso"}</Button>
    </form>
  );
}
