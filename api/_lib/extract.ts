import { claudeStructured, RECIPE_SCHEMA, RECIPE_SYSTEM, type ImageInput } from "./claude.js";
import { extractJsonLdRecipe, metaContent, pageText } from "./html.js";
import { BROWSER_UA } from "./http.js";
import { asCategory, type Ingredient } from "../../src/lib/types.js";

/** Fejl, der skyldes det, brugeren har sendt (forkert link, side der ikke kan hentes). */
export class InputError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Extracted {
  /** Titel fra Claude eller siden. */
  title: string | null;
  servings: number | null;
  image: string | null;
  /** Tom, hvis der ikke blev fundet ingredienser. */
  items: Ingredient[];
}

interface ClaudeRecipe {
  found: boolean;
  title: string;
  servings: number | null;
  items: { name: string; qty: number | null; unit: string; category: string; basic: boolean }[];
}

// Sociale medier viser kun billedtekst og billede til link-forhåndsvisninger.
const SOCIAL = /(^|\.)(instagram\.com|tiktok\.com|facebook\.com|fb\.watch|pinterest\.[a-z.]+|pin\.it)$/i;
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

export function safeUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/https?:\/\/\S+/);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    const h = u.hostname;
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(\d+\.){3}\d+$/.test(h) || h.includes(":")) return null;
    return u;
  } catch { return null; }
}

async function fetchPage(u: URL): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const ua = SOCIAL.test(u.hostname) ? CRAWLER_UA : BROWSER_UA;
    const r = await fetch(u, { headers: { "user-agent": ua, "accept-language": "da,en;q=0.8" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) throw new Error(`Siden svarede ${r.status}`);
    return (await r.text()).slice(0, 3_000_000);
  } finally { clearTimeout(t); }
}

/** Læs en opskrift fra et link, en tekst eller et billede. */
export async function extractRecipe(input: { url?: string; text?: string; image?: ImageInput | null }): Promise<Extracted> {
  let prompt: string;
  let image: string | null = null;
  let pageTitle: string | null = null;
  let servingsHint: number | null = null;

  if (input.url) {
    const u = safeUrl(input.url);
    if (!u) throw new InputError(400, "Linket ser ikke ud til at være en almindelig webadresse.");
    let html: string;
    try { html = await fetchPage(u); }
    catch { throw new InputError(422, "Siden kunne ikke hentes. Den kræver måske login. Kopiér opskriftens tekst og indsæt den i stedet."); }
    const structured = extractJsonLdRecipe(html);
    image = structured?.image ?? metaContent(html, "og:image");
    pageTitle = structured?.title ?? metaContent(html, "og:title");
    if (structured) {
      servingsHint = structured.servings;
      prompt = `Opskrift: ${structured.title ?? ""}\nAntal: ${structured.servings ?? "ukendt"}\nIngredienser:\n${structured.ingredients.join("\n")}`;
    } else {
      const desc = metaContent(html, "og:description") ?? metaContent(html, "description") ?? "";
      const body = SOCIAL.test(u.hostname) ? "" : pageText(html);
      if (!desc && !body) return { title: pageTitle, servings: null, image, items: [] };
      prompt = `Tekst fra ${u.hostname} (kan være en billedtekst fra sociale medier eller en side med menuer og reklamer):\nTitel: ${pageTitle ?? ""}\n${desc}\n\n${body}`;
    }
  } else if (input.text && input.text.trim().length > 5) {
    prompt = `Tekst kopieret fra en opskrift (kan indeholde menuer og reklamer):\n${input.text.slice(0, 20000)}`;
  } else if (input.image) {
    prompt = "Billedet viser en opskrift, fx fra en kogebog. Læs ingredienserne.";
  } else {
    throw new InputError(400, "Send et link, en tekst eller et billede.");
  }

  const r = await claudeStructured<ClaudeRecipe>({
    system: RECIPE_SYSTEM,
    text: prompt,
    images: input.image ? [input.image] : undefined,
    toolName: "gem_opskrift",
    schema: RECIPE_SCHEMA,
  });

  const items: Ingredient[] = (r.found ? r.items || [] : [])
    .filter((i) => i && typeof i.name === "string" && i.name.trim())
    .map((i) => ({
      name: i.name.toLowerCase().trim(),
      qty: typeof i.qty === "number" && isFinite(i.qty) ? i.qty : null,
      unit: typeof i.unit === "string" ? i.unit : "",
      category: asCategory(i.category),
      basic: !!i.basic,
    }));

  return {
    title: r.title?.trim() || pageTitle,
    servings: r.servings ?? servingsHint,
    image,
    items,
  };
}
