import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${sec}s`;
}

export function formatClose(closesAt: string, now: number) {
  const t = new Date(closesAt).getTime();
  const date = new Date(closesAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  return t > now ? `Cierra en ${formatDuration(t - now)} · ${date}` : `Cerrado el ${date}`;
}
