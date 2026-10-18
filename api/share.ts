import type { VercelRequest, VercelResponse } from "@vercel/node";
import { extractRecipe, InputError, safeUrl, type Extracted } from "./_lib/extract.js";

export const config = { maxDuration: 60 };

/**
 * Bruges af iOS-genvejen "Gem opskrift". Svarer med almindelig tekst, som genvejen viser.
 * POST /api/share?key=DELEKODE med JSON { "url": "..." } (eller tekst, der indeholder et link).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const reply = (status: number, text: string) => { res.status(status).setHeader("content-type", "text/plain; charset=utf-8"); res.send(text); };
  if (req.method !== "POST") return reply(405, "Brug POST.");

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const key = String(req.query.key || body.key || "");
  const raw = String(body.url || body.text || body.input || "");
  if (!/^[a-f0-9]{20,}$/.test(key)) return reply(401, "Genvejen mangler din delekode. Se Familie i appen.");
  const u = safeUrl(raw);
  if (!u) return reply(400, "Der var intet link at gemme.");

  let r: Extracted;
  try { r = await extractRecipe({ url: u.toString() }); }
  catch (e) {
    // Siden kunne ikke læses: gem linket alligevel, så ingredienserne kan hentes senere i appen.
    if (!(e instanceof InputError)) console.error(e);
    r = { title: null, servings: null, image: null, items: [], kcal_per_serving: null, instructions: null };
  }

  const title = r.title || u.hostname.replace(/^www\./, "");
  const supa = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const save = await fetch(`${supa}/rest/v1/rpc/save_shared_recipe`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anon!, authorization: `Bearer ${anon}` },
    body: JSON.stringify({ key, title, url: u.toString(), image: r.image, servings: r.servings, items: r.items, kcal: r.kcal_per_serving, instructions: r.instructions, nutrition: r.nutrition ?? null }),
  });
  if (!save.ok) {
    const t = await save.text();
    return reply(save.status === 400 && /delekode/i.test(t) ? 401 : 500, /delekode/i.test(t) ? "Delekoden virker ikke. Lav genvejen igen fra Familie i appen." : "Opskriften kunne ikke gemmes. Prøv igen.");
  }
  reply(200, r.items.length
    ? `Gemt i Opskrifter: ${title} (${r.items.length} ingredienser${r.kcal_per_serving ? `, ca. ${r.kcal_per_serving} kcal pr. person` : ""})`
    : `Linket er gemt i Opskrifter: ${title}. Ingredienserne kunne ikke læses, så tryk Hent ingredienser i appen.`);
}

function safeJson(s: string) { try { return JSON.parse(s || "{}"); } catch { return { text: s }; } }
