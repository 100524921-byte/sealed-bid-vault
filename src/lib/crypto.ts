// WebCrypto helpers shared by the browser and the server (workerd supports WebCrypto).
// Scheme:
//  - Signing: ECDSA P-256 / SHA-256. Private key lives only in the user's browser,
//    wrapped with AES-GCM using a PBKDF2-derived key from the user's passphrase.
//  - Sealing: hybrid. A random AES-256-GCM key encrypts the bid; that key is wrapped
//    with the process RSA-OAEP-3072 public key. The process private key is held by the
//    server and only released after the closing time.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable fingerprint of a public JWK (only key material fields, sorted). */
export async function jwkFingerprint(jwk: JsonWebKey): Promise<string> {
  const fields = jwk.kty === "EC" ? ["crv", "kty", "x", "y"] : ["e", "kty", "n"];
  const canonical = JSON.stringify(
    Object.fromEntries(fields.map((f) => [f, (jwk as Record<string, unknown>)[f]])),
  );
  const hex = await sha256Hex(canonical);
  return hex.slice(0, 32).match(/.{4}/g)!.join(":").toUpperCase();
}

/** The exact string that is hashed and signed for every bid. */
export function bidSigningMessage(p: {
  processId: string;
  iv: string;
  wrappedKey: string;
  ciphertext: string;
}): string {
  return `bidvault/v1|${p.processId}|${p.iv}|${p.wrappedKey}|${p.ciphertext}`;
}

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const RSA = { name: "RSA-OAEP", hash: "SHA-256" } as const;

export async function generateSigningKeyPair() {
  const kp = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicJwk, privateJwk };
}

export async function generateSealingKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["encrypt", "decrypt"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicJwk, privateJwk };
}

export async function signMessage(privateJwk: JsonWebKey, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, ECDSA, false, ["sign"]);
  const sig = await crypto.subtle.sign(ECDSA_SIGN, key, enc.encode(message));
  return toB64(sig);
}

export async function verifySignature(
  publicJwk: JsonWebKey,
  message: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const { kty, crv, x, y } = publicJwk;
    const key = await crypto.subtle.importKey("jwk", { kty, crv, x, y }, ECDSA, false, ["verify"]);
    return await crypto.subtle.verify(ECDSA_SIGN, key, fromB64(signatureB64), enc.encode(message));
  } catch {
    return false;
  }
}

export type SealedBid = { iv: string; wrappedKey: string; ciphertext: string };

export async function sealPayload(
  processPublicJwk: JsonWebKey,
  processId: string,
  payload: unknown,
): Promise<SealedBid> {
  const { kty, n, e } = processPublicJwk;
  const rsa = await crypto.subtle.importKey("jwk", { kty, n, e, alg: "RSA-OAEP-256" }, RSA, false, [
    "encrypt",
  ]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(processId) },
    aes,
    enc.encode(JSON.stringify(payload)),
  );
  const rawAes = await crypto.subtle.exportKey("raw", aes);
  const wrapped = await crypto.subtle.encrypt(RSA, rsa, rawAes);
  return { iv: toB64(iv), wrappedKey: toB64(wrapped), ciphertext: toB64(ct) };
}

export async function openPayload<T = unknown>(
  processPrivateJwk: JsonWebKey,
  processId: string,
  sealed: SealedBid,
): Promise<T> {
  const rsa = await crypto.subtle.importKey(
    "jwk",
    { ...processPrivateJwk, alg: "RSA-OAEP-256", key_ops: ["decrypt"] },
    RSA,
    false,
    ["decrypt"],
  );
  const rawAes = await crypto.subtle.decrypt(RSA, rsa, fromB64(sealed.wrappedKey));
  const aes = await crypto.subtle.importKey("raw", rawAes, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: enc.encode(processId) },
    aes,
    fromB64(sealed.ciphertext),
  );
  return JSON.parse(dec.decode(pt)) as T;
}

// ---- Passphrase protection of the private signing key ----

export type WrappedPrivateKey = {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
  publicJwk: JsonWebKey;
  fingerprint: string;
};

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapPrivateKey(
  privateJwk: JsonWebKey,
  publicJwk: JsonWebKey,
  passphrase: string,
): Promise<WrappedPrivateKey> {
  const iterations = 310_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passphraseKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(privateJwk)));
  return {
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    iterations,
    publicJwk,
    fingerprint: await jwkFingerprint(publicJwk),
  };
}

export async function unwrapPrivateKey(w: WrappedPrivateKey, passphrase: string): Promise<JsonWebKey> {
  const key = await passphraseKey(passphrase, fromB64(w.salt), w.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(w.iv) }, key, fromB64(w.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error("Frase de paso incorrecta");
  }
}
