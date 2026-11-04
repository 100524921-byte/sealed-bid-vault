// Browser-only storage of the passphrase-wrapped signing key. Call from effects/handlers only.
import type { WrappedPrivateKey } from "@/lib/crypto";

const k = (userId: string) => `bidvault:signing-key:${userId}`;

export function loadWrappedKey(userId: string): WrappedPrivateKey | null {
  const raw = window.localStorage.getItem(k(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WrappedPrivateKey;
  } catch {
    return null;
  }
}

export function saveWrappedKey(userId: string, w: WrappedPrivateKey) {
  window.localStorage.setItem(k(userId), JSON.stringify(w));
}

export function deleteWrappedKey(userId: string) {
  window.localStorage.removeItem(k(userId));
}
