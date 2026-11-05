import { createFileRoute, Link } from "@tanstack/react-router";
import { FileSignature, KeyRound, Lock, Timer } from "lucide-react";
import { Logo } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BidVault — Ofertas selladas para M&A y subastas privadas" },
      {
        name: "description",
        content: "Ofertas cifradas que nadie puede leer hasta el cierre, firmadas digitalmente para verificar autoría e integridad.",
      },
      { property: "og:title", content: "BidVault — Ofertas selladas" },
      { property: "og:description", content: "Ofertas cifradas y firmadas para procesos de M&A y subastas privadas." },
    ],
  }),
  component: Index,
});

const steps = [
  { icon: KeyRound, t: "Tu clave, en tu navegador", d: "Cada participante genera su clave de firma localmente. La privada nunca sale de su dispositivo." },
  { icon: Lock, t: "Cifrado híbrido", d: "AES-256-GCM para la oferta, RSA-OAEP-3072 para sellar la clave. Ilegible hasta el cierre." },
  { icon: FileSignature, t: "Firma ECDSA", d: "Cada oferta va firmada: se verifica quién la envió y que nadie la ha alterado." },
  { icon: Timer, t: "Apertura automática", d: "La clave de apertura solo se libera tras la fecha de cierre. Todo queda en el registro de auditoría." },
];

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo />
        <Button variant="ghost" asChild>
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-4">
        <section className="py-16 md:py-28">
          <p className="eyebrow">Sealed-bid infrastructure</p>
          <h1 className="mt-4 max-w-4xl text-5xl leading-[1.02] md:text-7xl">
            Nadie lee una oferta <span className="text-brass italic">antes de tiempo.</span>
          </h1>
          <p className="mt-6 max-w-xl text-muted-foreground">
            Procesos de M&A y subastas privadas con ofertas cifradas, firmadas y verificables de extremo a extremo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link to="/auth">Crear cuenta</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/dashboard">Ver procesos</Link>
            </Button>
          </div>
        </section>
        <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border pb-px md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.t} className="bg-card p-6">
              <s.icon className="h-5 w-5 text-primary" />
              <h2 className="mt-4 text-2xl">{s.t}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </section>
        <footer className="py-12 font-mono text-xs text-muted-foreground">BidVault · demo</footer>
      </main>
    </div>
  );
}
