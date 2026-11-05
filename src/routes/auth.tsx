import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acceso — BidVault" },
      { name: "description", content: "Inicia sesión o crea tu cuenta en BidVault para participar en procesos de ofertas selladas." },
      { property: "og:title", content: "Acceso — BidVault" },
      { property: "og:description", content: "Inicia sesión o crea tu cuenta en BidVault." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [role, setRole] = useState("bidder");

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    navigate({ to: "/dashboard" });
  }

  async function signUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: String(f.get("password")),
      options: {
        emailRedirectTo: window.location.origin + "/dashboard",
        data: {
          display_name: String(f.get("name")),
          organization: String(f.get("org")),
          role,
        },
      },
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    if (data.session) navigate({ to: "/keys" });
    else setSent(email);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-seal">
        {sent ? (
          <div className="space-y-3 text-center">
            <h1 className="text-3xl">Revisa tu correo</h1>
            <p className="text-sm text-muted-foreground">
              Hemos enviado un enlace de confirmación a <span className="text-foreground">{sent}</span>. Ábrelo para activar tu cuenta.
            </p>
          </div>
        ) : (
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Crear cuenta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={signIn} className="mt-4 space-y-4">
                <Field id="email" label="Correo" type="email" />
                <Field id="password" label="Contraseña" type="password" />
                <Button className="w-full" disabled={busy}>
                  Entrar
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={signUp} className="mt-4 space-y-4">
                <Field id="name" label="Nombre" />
                <Field id="org" label="Entidad" required={false} />
                <div className="space-y-2">
                  <Label>Rol</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bidder">Participante / comprador</SelectItem>
                      <SelectItem value="organizer">Organizador / vendedor</SelectItem>
                      <SelectItem value="auditor">Auditor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field id="email" label="Correo" type="email" />
                <Field id="password" label="Contraseña" type="password" minLength={8} />
                <Button className="w-full" disabled={busy}>
                  Crear cuenta
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type = "text",
  required = true,
  minLength,
}: {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type={type} required={required} minLength={minLength} />
    </div>
  );
}
