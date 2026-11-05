import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileLock2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { formatClose, useNow } from "@/lib/time";
import {
  bidSigningMessage,
  openPayload,
  sealPayload,
  sha256Hex,
  signMessage,
  unwrapPrivateKey,
  verifySignature,
} from "@/lib/crypto";
import { loadWrappedKey } from "@/lib/keystore";
import { getProcessStats, revealProcess, submitBid } from "@/lib/bidvault.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/StatusPill";

export const Route = createFileRoute("/_authenticated/processes/$id")({
  head: () => ({
    meta: [
      { title: "Proceso — BidVault" },
      { name: "description", content: "Detalle del proceso de ofertas selladas." },
      { property: "og:title", content: "Proceso — BidVault" },
      { property: "og:description", content: "Detalle del proceso de ofertas selladas." },
    ],
  }),
  component: ProcessPage,
});

function ProcessPage() {
  const { id } = Route.useParams();
  const { data: me } = useMe();
  const now = useNow();
  const { data: p } = useQuery({
    queryKey: ["process", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processes")
        .select("*, profiles(display_name, organization)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const { data: stats } = useQuery({
    queryKey: ["stats", id],
    queryFn: () => getProcessStats({ data: { processId: id } }),
    refetchInterval: 10000,
  });
  const { data: myBid } = useQuery({
    queryKey: ["mybid", id, me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await supabase
        .from("bids")
        .select("id, submitted_at, payload_hash, signer_fingerprint")
        .eq("process_id", id)
        .eq("bidder_id", me!.id)
        .maybeSingle();
      return data;
    },
  });

  if (!p || !me) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const open = new Date(p.closes_at).getTime() > now;
  const canReveal = p.organizer_id === me.id || me.roles.includes("auditor");
  const isBidder = me.roles.includes("bidder");

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <p className="eyebrow">{p.asset_type}</p>
          <StatusPill open={open} />
        </div>
        <h1 className="text-4xl md:text-5xl">{p.title}</h1>
        <p className="text-sm text-muted-foreground">
          {p.profiles?.organization || p.profiles?.display_name}
        </p>
        {p.description && <p className="max-w-3xl whitespace-pre-wrap text-sm">{p.description}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Cierre" value={formatClose(p.closes_at, now)} />
        <Stat label="Ofertas selladas" value={String(stats?.sealedCount ?? "—")} />
        <Stat label="Huella clave de sellado" value={p.key_fingerprint} mono />
      </div>

      {myBid && <Receipt bid={myBid} />}
      {open && isBidder && !myBid && <BidForm processId={id} publicKey={p.encryption_public_key as JsonWebKey} />}
      {open && canReveal && (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          <FileLock2 className="mb-2 h-5 w-5 text-sealed" />
          Las ofertas permanecen cifradas. Ni tú ni BidVault podéis leerlas hasta el cierre.
        </div>
      )}
      {!open && canReveal && <Reveal processId={id} />}
      {!open && !canReveal && (
        <p className="text-sm text-muted-foreground">Proceso cerrado. El organizador ya puede abrir las ofertas.</p>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow">{label}</p>
      <p className={mono ? "mt-2 font-mono text-xs break-all" : "mt-2 text-sm"}>{value}</p>
    </div>
  );
}

function Receipt({ bid }: { bid: { submitted_at: string; payload_hash: string; signer_fingerprint: string } }) {
  return (
    <div className="rounded-lg border border-primary/40 bg-accent p-5">
      <p className="eyebrow">Acuse de recibo</p>
      <h2 className="mt-1 text-2xl">Tu oferta está sellada</h2>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Enviada</dt>
          <dd>{new Date(bid.submitted_at).toLocaleString("es-ES")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Huella SHA-256</dt>
          <dd className="font-mono break-all">{bid.payload_hash}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Firmada con</dt>
          <dd className="font-mono break-all">{bid.signer_fingerprint}</dd>
        </div>
      </dl>
    </div>
  );
}

function BidForm({ processId, publicKey }: { processId: string; publicKey: JsonWebKey }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const wrapped = loadWrappedKey(me!.id);
    if (!wrapped) return toast.error("No hay clave de firma en este navegador. Ve a Mis claves.");
    if (wrapped.fingerprint !== me!.profile?.key_fingerprint)
      return toast.error("Tu clave local no coincide con la registrada.");
    setBusy(true);
    try {
      const priv = await unwrapPrivateKey(wrapped, String(f.get("pass")));
      const payload = {
        processId,
        bidderId: me!.id,
        amount: Number(f.get("amount")),
        currency: String(f.get("currency")),
        conditions: String(f.get("conditions")),
        nonce: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const sealed = await sealPayload(publicKey, processId, payload);
      const message = bidSigningMessage({ processId, ...sealed });
      const [payloadHash, signature] = await Promise.all([sha256Hex(message), signMessage(priv, message)]);
      await submitBid({ data: { processId, ...sealed, payloadHash, signature } });
      toast.success("Oferta cifrada, firmada y sellada");
      qc.invalidateQueries({ queryKey: ["mybid", processId] });
      qc.invalidateQueries({ queryKey: ["stats", processId] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-3xl">Enviar oferta sellada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Se cifra y firma en tu navegador antes de salir. Solo se puede enviar una oferta.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div className="space-y-2">
          <Label htmlFor="amount">Importe</Label>
          <Input id="amount" name="amount" type="number" min="1" step="any" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Moneda</Label>
          <Input id="currency" name="currency" defaultValue="EUR" required maxLength={3} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="conditions">Condiciones</Label>
        <Textarea id="conditions" name="conditions" rows={3} placeholder="Sujeto a due diligence confirmatoria…" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pass">Frase de paso de tu clave</Label>
        <Input id="pass" name="pass" type="password" required />
      </div>
      <Button disabled={busy}>{busy ? "Sellando…" : "Cifrar, firmar y enviar"}</Button>
    </form>
  );
}

type Opened = {
  id: string;
  bidder: string;
  org: string;
  amount?: number;
  currency?: string;
  conditions?: string;
  submitted_at: string;
  sigOk: boolean;
  hashOk: boolean;
  identityOk: boolean;
  decryptOk: boolean;
};

function Reveal({ processId }: { processId: string }) {
  const [rows, setRows] = useState<Opened[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [tamper, setTamper] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const r = await revealProcess({ data: { processId } });
      const priv = r.privateKey as JsonWebKey;
      const out: Opened[] = [];
      for (const [i, b] of r.bids.entries()) {
        const prof = r.profiles.find((x) => x.id === b.bidder_id);
        let ciphertext = b.ciphertext;
        if (tamper && i === 0) ciphertext = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
        const sealed = { iv: b.iv, wrappedKey: b.wrapped_key, ciphertext };
        const message = bidSigningMessage({ processId, ...sealed });
        const hashOk = (await sha256Hex(message)) === b.payload_hash;
        const sigOk = prof?.signing_public_key
          ? await verifySignature(prof.signing_public_key as JsonWebKey, message, b.signature)
          : false;
        let payload: { amount?: number; currency?: string; conditions?: string; bidderId?: string; processId?: string } = {};
        let decryptOk = true;
        try {
          payload = await openPayload(priv, processId, sealed);
        } catch {
          decryptOk = false;
        }
        out.push({
          id: b.id,
          bidder: prof?.display_name ?? "?",
          org: prof?.organization ?? "",
          amount: payload.amount,
          currency: payload.currency,
          conditions: payload.conditions,
          submitted_at: b.submitted_at,
          sigOk,
          hashOk,
          decryptOk,
          identityOk: payload.bidderId === b.bidder_id && payload.processId === processId,
        });
      }
      out.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
      setRows(out);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={open} disabled={busy}>
          {busy ? "Abriendo…" : rows ? "Volver a verificar" : "Abrir y verificar ofertas"}
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={tamper} onCheckedChange={setTamper} /> Simular manipulación de la 1.ª oferta
        </label>
      </div>
      {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No se recibieron ofertas.</p>}
      {rows?.map((r, i) => (
        <div key={r.id} className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="eyebrow">#{i + 1} · {new Date(r.submitted_at).toLocaleString("es-ES")}</p>
              <h3 className="mt-1 text-2xl">{r.bidder} {r.org && <span className="text-base text-muted-foreground">· {r.org}</span>}</h3>
            </div>
            <p className="font-display text-3xl text-brass">
              {r.amount != null ? `${r.amount.toLocaleString("es-ES")} ${r.currency}` : "Ilegible"}
            </p>
          </div>
          {r.conditions && <p className="mt-2 text-sm text-muted-foreground">{r.conditions}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Check ok={r.decryptOk} label="Descifrado" />
            <Check ok={r.hashOk} label="Integridad" />
            <Check ok={r.sigOk} label="Firma digital" />
            <Check ok={r.identityOk} label="Identidad" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " +
        (ok ? "border-success/50 text-success" : "border-destructive/60 text-destructive")
      }
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {label}
    </span>
  );
}
