import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, KeyRound, Upload } from "lucide-react";
import { useMe } from "@/hooks/use-me";
import { generateSigningKeyPair, unwrapPrivateKey, wrapPrivateKey, type WrappedPrivateKey } from "@/lib/crypto";
import { loadWrappedKey, saveWrappedKey } from "@/lib/keystore";
import { registerSigningKey } from "@/lib/bidvault.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/keys")({
  head: () => ({
    meta: [
      { title: "Mis claves — BidVault" },
      { name: "description", content: "Genera y custodia tu clave de firma digital en tu propio navegador." },
      { property: "og:title", content: "Mis claves — BidVault" },
      { property: "og:description", content: "Gestión de claves de firma en el navegador." },
    ],
  }),
  component: KeysPage,
});

function KeysPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [local, setLocal] = useState<WrappedPrivateKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) setLocal(loadWrappedKey(me.id));
  }, [me]);

  if (!me) return null;
  const serverFp = me.profile?.key_fingerprint ?? null;
  const matches = local && serverFp === local.fingerprint;

  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p1 = String(f.get("p1"));
    if (p1 !== String(f.get("p2"))) return void toast.error("Las frases no coinciden");
    if (p1.length < 10) return void toast.error("Usa al menos 10 caracteres");
    setBusy(true);
    try {
      const { publicJwk, privateJwk } = await generateSigningKeyPair();
      const wrapped = await wrapPrivateKey(privateJwk, publicJwk, p1);
      await registerSigningKey({ data: { publicJwk: publicJwk as never } });
      saveWrappedKey(me!.id, wrapped);
      setLocal(wrapped);
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Clave generada y registrada");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(local, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bidvault-clave-${local!.fingerprint.slice(0, 9).replace(":", "")}.json`;
    a.click();
  }

  async function importBackup(file: File) {
    try {
      const w = JSON.parse(await file.text()) as WrappedPrivateKey;
      if (w.v !== 1 || !w.ct || !w.publicJwk) throw new Error("Archivo no válido");
      const pass = window.prompt("Frase de paso de esta copia");
      if (!pass) return;
      await unwrapPrivateKey(w, pass);
      saveWrappedKey(me!.id, w);
      setLocal(w);
      toast.success("Copia importada");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="eyebrow">Gestión de claves</p>
        <h1 className="mt-2 text-4xl">Tu clave de firma</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Se genera en este navegador (ECDSA P-256). La parte privada nunca sale de aquí: se guarda cifrada con tu frase de paso. Solo la parte pública se registra en BidVault para verificar tus firmas.
        </p>
      </div>

      {local ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-primary" />
            <span className="font-mono text-sm break-all">{local.fingerprint}</span>
          </div>
          <p className={matches ? "text-sm text-success" : "text-sm text-destructive"}>
            {matches
              ? "Coincide con la clave pública registrada."
              : "Esta clave local no coincide con la registrada en tu cuenta. Genera una nueva o importa la copia correcta."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportBackup}>
              <Download className="h-4 w-4" /> Exportar copia cifrada
            </Button>
            <ImportButton onFile={importBackup} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          No hay clave en este navegador.{" "}
          {serverFp && <>Tu cuenta tiene registrada <span className="font-mono text-foreground">{serverFp}</span>; importa su copia o genera otra.</>}
          <div className="mt-3">
            <ImportButton onFile={importBackup} />
          </div>
        </div>
      )}

      <form onSubmit={generate} className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-2xl">{local ? "Rotar clave" : "Generar clave"}</h2>
        {local && (
          <p className="text-sm text-muted-foreground">
            Rotar sustituye tu clave registrada. Las ofertas ya firmadas con la anterior dejarán de verificar.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="p1">Frase de paso</Label>
          <Input id="p1" name="p1" type="password" required minLength={10} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p2">Repite la frase</Label>
          <Input id="p2" name="p2" type="password" required />
        </div>
        <Button disabled={busy}>{busy ? "Generando…" : local ? "Rotar clave" : "Generar y registrar"}</Button>
      </form>
    </div>
  );
}

function ImportButton({ onFile }: { onFile: (f: File) => void }) {
  return (
    <Button variant="outline" asChild>
      <label className="cursor-pointer">
        <Upload className="h-4 w-4" /> Importar copia
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
    </Button>
  );
}
