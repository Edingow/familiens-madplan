import type { VercelRequest, VercelResponse } from "@vercel/node";
import { claudeStructured, RECIPE_SCHEMA, RECIPE_SYSTEM } from "./_lib/claude.js";
import { extractJsonLdRecipe, metaContent, pageText } from "./_lib/html.js";
import { BROWSER_UA, fail, readImage, requireUser } from "./_lib/http.js";
import { asCategory, type ParsedRecipe } from "../src/lib/types.js";

export const config = { maxDuration: 60 };

interface ClaudeRecipe {
  found: boolean;
  title: string;
  servings: number | null;
  items: { name: string; qty: number | null; unit: string; category: string; basic: boolean }[];
}

function safeUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname;
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(\d+\.){3}\d+$/.test(h) || h.includes(":")) return null;
    return u;
  } catch { return null; }
}

async function fetchPage(u: URL): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(u, { headers: { "user-agent": BROWSER_UA, "accept-language": "da,en;q=0.8" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) throw new Error(`Siden svarede ${r.status}`);
    const text = await r.text();
    return text.slice(0, 3_000_000);
  } finally { clearTimeout(t); }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return fail(res, 405, "Brug POST");
  if (!(await requireUser(req, res))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  try {
    let prompt = "";
    let image: string | null = null;
    let pageTitle: string | null = null;
    let servingsHint: number | null = null;
    const img = readImage(body);

    if (body.url) {
      const u = safeUrl(body.url);
      if (!u) return fail(res, 400, "Linket ser ikke ud til at være en almindelig webadresse.");
      let html: string;
      try { html = await fetchPage(u); }
      catch { return fail(res, 422, "Siden kunne ikke hentes. Den kræver måske login. Kopiér opskriftens tekst og indsæt den i stedet."); }
      const structured = extractJsonLdRecipe(html);
      image = structured?.image ?? metaContent(html, "og:image");
      pageTitle = structured?.title ?? metaContent(html, "og:title");
      if (structured) {
        servingsHint = structured.servings;
        prompt = `Opskrift: ${structured.title ?? ""}\nAntal: ${structured.servings ?? "ukendt"}\nIngredienser:\n${structured.ingredients.join("\n")}`;
      } else {
        const desc = metaContent(html, "og:description") ?? "";
        prompt = `Tekst fra opskriftssiden ${u.hostname} (kan indeholde menuer og reklamer):\nTitel: ${pageTitle ?? ""}\n${desc}\n\n${pageText(html)}`;
      }
    } else if (typeof body.text === "string" && body.text.trim().length > 5) {
      prompt = `Tekst kopieret fra en opskrift (kan indeholde menuer og reklamer):\n${body.text.slice(0, 20000)}`;
    } else if (img) {
      prompt = "Billedet viser en opskrift, fx fra en kogebog. Læs ingredienserne.";
    } else {
      return fail(res, 400, "Send et link, en tekst eller et billede.");
    }

    const r = await claudeStructured<ClaudeRecipe>({
      system: RECIPE_SYSTEM,
      text: prompt,
      images: img ? [img] : undefined,
      toolName: "gem_opskrift",
      schema: RECIPE_SCHEMA,
    });

    const items = (r.items || [])
      .filter((i) => i && typeof i.name === "string" && i.name.trim())
      .map((i) => ({
        name: i.name.toLowerCase().trim(),
        qty: typeof i.qty === "number" && isFinite(i.qty) ? i.qty : null,
        unit: typeof i.unit === "string" ? i.unit : "",
        category: asCategory(i.category),
        basic: !!i.basic,
      }));
    if (!r.found || !items.length) return fail(res, 422, "Der blev ikke fundet nogen ingredienser. Prøv at indsætte selve ingredienslisten.");

    const out: ParsedRecipe = {
      title: r.title?.trim() || pageTitle || "Opskrift",
      servings: r.servings ?? servingsHint,
      image,
      items,
    };
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    fail(res, 500, "Opskriften kunne ikke læses lige nu. Prøv igen om lidt.");
  }
}
