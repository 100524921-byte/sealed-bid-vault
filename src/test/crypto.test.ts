import { describe, expect, it } from "vitest";
import {
  bidSigningMessage,
  generateSealingKeyPair,
  generateSigningKeyPair,
  openPayload,
  sealPayload,
  signMessage,
  unwrapPrivateKey,
  verifySignature,
  wrapPrivateKey,
} from "@/lib/crypto";

const pid = "11111111-1111-1111-1111-111111111111";

describe("BidVault crypto", () => {
  it("sealed bid opens only with the process private key and the same process id", async () => {
    const proc = await generateSealingKeyPair();
    const sealed = await sealPayload(proc.publicJwk, pid, { amount: 1000 });
    expect(await openPayload(proc.privateJwk, pid, sealed)).toEqual({ amount: 1000 });
    await expect(openPayload(proc.privateJwk, "other", sealed)).rejects.toThrow();
    const other = await generateSealingKeyPair();
    await expect(openPayload(other.privateJwk, pid, sealed)).rejects.toThrow();
  }, 30000);

  it("signature fails when the ciphertext is modified", async () => {
    const proc = await generateSealingKeyPair();
    const signer = await generateSigningKeyPair();
    const sealed = await sealPayload(proc.publicJwk, pid, { amount: 5 });
    const msg = bidSigningMessage({ processId: pid, ...sealed });
    const sig = await signMessage(signer.privateJwk, msg);
    expect(await verifySignature(signer.publicJwk, msg, sig)).toBe(true);
    const tampered = bidSigningMessage({ processId: pid, ...sealed, ciphertext: "X" + sealed.ciphertext.slice(1) });
    expect(await verifySignature(signer.publicJwk, tampered, sig)).toBe(false);
  }, 30000);

  it("private signing key requires the right passphrase", async () => {
    const k = await generateSigningKeyPair();
    const w = await wrapPrivateKey(k.privateJwk, k.publicJwk, "correct horse battery");
    expect((await unwrapPrivateKey(w, "correct horse battery")).d).toBe(k.privateJwk.d);
    await expect(unwrapPrivateKey(w, "wrong passphrase")).rejects.toThrow();
  }, 30000);
});
