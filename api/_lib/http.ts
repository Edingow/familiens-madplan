import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ImageInput } from "./claude.js";

/** Kun familiens egne, indloggede brugere må bruge serverfunktionerne (de koster AI-kald). */
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) { res.status(401).json({ error: "Log ind igen." }); return null; }
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) { res.status(401).json({ error: "Log ind igen." }); return null; }
  const u = await r.json();
  return u?.id ?? null;
}

export function readImage(body: any): ImageInput | null {
  const s = body?.image;
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return null;
  if (m[2].length > 6_000_000) return null;
  return { mediaType: m[1], base64: m[2] };
}

export const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export function fail(res: VercelResponse, status: number, error: string) {
  res.status(status).json({ error });
}
