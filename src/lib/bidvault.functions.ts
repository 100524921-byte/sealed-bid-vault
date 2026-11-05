import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  bidSigningMessage,
  generateSealingKeyPair,
  jwkFingerprint,
  sha256Hex,
  verifySignature,
} from "@/lib/crypto";
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function log(processId: string | null, actorId: string, action: string, details: Record<string, unknown> = {}) {
  const db = await admin();
  await db.from("audit_log").insert({ process_id: processId, actor_id: actorId, action, details: details as Json });
}

type Ctx = { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };
async function hasRole(ctx: Ctx, role: "organizer" | "bidder" | "auditor") {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: role });
  if (error) throw new Error(error.message);
  return data === true;
}

const ecJwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().min(40), y: z.string().min(40) });

export const registerSigningKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ publicJwk: ecJwk }).parse(d))
  .handler(async ({ data, context }) => {
    const { kty, crv, x, y } = data.publicJwk;
    const jwk = { kty, crv, x, y };
    const fingerprint = await jwkFingerprint(jwk);
    const db = await admin();
    const { data: prev } = await db.from("profiles").select("key_fingerprint").eq("id", context.userId).single();
    const { error } = await db
      .from("profiles")
      .update({ signing_public_key: jwk as Json, key_fingerprint: fingerprint, key_registered_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    await log(null, context.userId, prev?.key_fingerprint ? "key.rotated" : "key.registered", {
      fingerprint,
      previous: prev?.key_fingerprint ?? null,
    });
    return { fingerprint };
  });

export const createProcess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        title: z.string().trim().min(3).max(140),
        description: z.string().trim().max(2000),
        assetType: z.string().trim().min(1).max(60),
        closesAt: z.string().datetime(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context, "organizer"))) throw new Error("Solo los organizadores pueden crear procesos");
    if (new Date(data.closesAt).getTime() < Date.now() + 60_000)
      throw new Error("La fecha de cierre debe ser al menos 1 minuto en el futuro");
    const { publicJwk, privateJwk } = await generateSealingKeyPair();
    const pub = { kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e };
    const fingerprint = await jwkFingerprint(pub as JsonWebKey);
    const db = await admin();
    const { data: row, error } = await db
      .from("processes")
      .insert({
        organizer_id: context.userId,
        title: data.title,
        description: data.description,
        asset_type: data.assetType,
        closes_at: data.closesAt,
        encryption_public_key: pub as Json,
        key_fingerprint: fingerprint,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "No se pudo crear");
    const { error: kErr } = await db.from("process_keys").insert({ process_id: row.id, private_key: privateJwk as Json });
    if (kErr) {
      await db.from("processes").delete().eq("id", row.id);
      throw new Error(kErr.message);
    }
    await log(row.id, context.userId, "process.created", { title: data.title, closes_at: data.closesAt, fingerprint });
    return { id: row.id };
  });

export const getProcessStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ processId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { count } = await db
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq("process_id", data.processId);
    return { sealedCount: count ?? 0 };
  });

export const submitBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        processId: z.string().uuid(),
        iv: z.string().min(8).max(64),
        wrappedKey: z.string().min(100).max(2000),
        ciphertext: z.string().min(16).max(40000),
        payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
        signature: z.string().min(40).max(400),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context, "bidder"))) throw new Error("Solo los participantes pueden ofertar");
    const db = await admin();
    const { data: proc } = await db.from("processes").select("closes_at").eq("id", data.processId).single();
    if (!proc) throw new Error("Proceso no encontrado");
    if (new Date(proc.closes_at).getTime() <= Date.now()) throw new Error("El proceso ya está cerrado");
    const { data: prof } = await db
      .from("profiles")
      .select("signing_public_key, key_fingerprint")
      .eq("id", context.userId)
      .single();
    if (!prof?.signing_public_key || !prof.key_fingerprint) throw new Error("Registra primero tu clave de firma");

    const message = bidSigningMessage(data);
    if ((await sha256Hex(message)) !== data.payloadHash) throw new Error("La huella de integridad no coincide");
    const ok = await verifySignature(prof.signing_public_key as JsonWebKey, message, data.signature);
    if (!ok) {
      await log(data.processId, context.userId, "bid.rejected", { reason: "invalid_signature" });
      throw new Error("Firma digital no válida para tu clave registrada");
    }

    const { data: row, error } = await db
      .from("bids")
      .insert({
        process_id: data.processId,
        bidder_id: context.userId,
        ciphertext: data.ciphertext,
        iv: data.iv,
        wrapped_key: data.wrappedKey,
        payload_hash: data.payloadHash,
        signature: data.signature,
        signer_fingerprint: prof.key_fingerprint,
      })
      .select("id, submitted_at, payload_hash, signer_fingerprint")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Ya has enviado una oferta en este proceso");
      throw new Error(error.message);
    }
    await log(data.processId, context.userId, "bid.sealed", {
      bid_id: row.id,
      payload_hash: row.payload_hash,
      signer: row.signer_fingerprint,
    });
    return row;
  });

export const revealProcess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ processId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: proc } = await db
      .from("processes")
      .select("id, organizer_id, closes_at")
      .eq("id", data.processId)
      .single();
    if (!proc) throw new Error("Proceso no encontrado");
    const isOrganizer = proc.organizer_id === context.userId;
    if (!isOrganizer && !(await hasRole(context, "auditor")))
      throw new Error("Solo el organizador o un auditor pueden abrir las ofertas");
    if (new Date(proc.closes_at).getTime() > Date.now()) {
      await log(data.processId, context.userId, "reveal.denied", { reason: "not_closed" });
      throw new Error("Las ofertas siguen selladas hasta la fecha de cierre");
    }
    const { data: key } = await db.from("process_keys").select("private_key").eq("process_id", data.processId).single();
    const { data: bids } = await db
      .from("bids")
      .select("id, bidder_id, ciphertext, iv, wrapped_key, payload_hash, signature, signer_fingerprint, submitted_at")
      .eq("process_id", data.processId)
      .order("submitted_at");
    const ids = [...new Set((bids ?? []).map((b) => b.bidder_id))];
    const { data: profiles } = ids.length
      ? await db.from("profiles").select("id, display_name, organization, signing_public_key, key_fingerprint").in("id", ids)
      : { data: [] };
    await log(data.processId, context.userId, "process.revealed", {
      by: isOrganizer ? "organizer" : "auditor",
      bids: bids?.length ?? 0,
    });
    return {
      privateKeyJson: JSON.stringify(key?.private_key ?? null),
      bids: bids ?? [],
      profiles: (profiles ?? []).map((p) => ({
        id: p.id,
        display_name: p.display_name,
        organization: p.organization,
        key_fingerprint: p.key_fingerprint,
        publicKeyJson: p.signing_public_key ? JSON.stringify(p.signing_public_key) : null,
      })),
    };
  });
