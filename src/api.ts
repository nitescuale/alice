/** API base: dev uses Vite proxy /api → backend; build uses direct URL (Tauri). */
export const apiBase =
  import.meta.env.DEV ? "" : "http://127.0.0.1:8765";

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json() as Promise<T>;
}
