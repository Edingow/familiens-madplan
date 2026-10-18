import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!(url && anon);

export const supabase = createClient(url || "http://localhost", anon || "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Kald en af appens serverfunktioner med brugerens login. */
export async function callApi<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `Serveren svarede med fejl ${r.status}. Prøv igen om lidt.`);
  return json as T;
}

export function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message || "";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Ingen forbindelse. Prøv igen, når du har net.";
  return m || "Noget gik galt. Prøv igen.";
}
