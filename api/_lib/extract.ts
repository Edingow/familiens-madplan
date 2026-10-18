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
  kcal_per_serving: number | null;
  instructions: string | null;
}

interface ClaudeRecipe {
  found: boolean;
  title: string;
  servings: number | null;
  kcal_per_serving?: number | null;
  instructions?: string | null;
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

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const BLOCKED = /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required|captcha/i;

async function tryFetch(url: string, headers: Record<string, string>): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) return null;
    const text = (await r.text()).slice(0, 3_000_000);
    return BLOCKED.test(text.slice(0, 20000)) && !/application\/ld\+json/i.test(text) ? null : text;
  } catch { return null; } finally { clearTimeout(t); }
}

/** Hent siden. Mange sider blokerer servere, så der prøves flere veje, til sidst via en læsetjeneste. */
export async function fetchPage(u: URL): Promise<{ html: string; viaReader: boolean }> {
  const common = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "da-DK,da;q=0.9,en;q=0.8" };
  const uas = SOCIAL.test(u.hostname) ? [CRAWLER_UA, BROWSER_UA] : [BROWSER_UA, DESKTOP_UA, CRAWLER_UA];
  for (const ua of uas) {
    const html = await tryFetch(u.toString(), { ...common, "user-agent": ua });
    if (html) return { html, viaReader: false };
  }
  // Reserve: Jina Reader henter siden for os. Som HTML får vi også billede og opskriftsdata med.
  const html = await tryFetch(`https://r.jina.ai/${u.toString()}`, { accept: "text/html", "x-return-format": "html" });
  if (html && html.trim().length > 200) return { html, viaReader: /<html|<head|<meta/i.test(html) ? false : true };
  const text = await tryFetch(`https://r.jina.ai/${u.toString()}`, { accept: "text/plain", "x-return-format": "text" });
  if (text && text.trim().length > 200) return { html: text, viaReader: true };
  throw new Error("Siden kunne ikke hentes");
}

/** Læs en opskrift fra et link, en tekst eller et billede. */
export async function extractRecipe(input: { url?: string; text?: string; image?: ImageInput | null }): Promise<Extracted> {
  let prompt: string;
  let image: string | null = null;
  let pageTitle: string | null = null;
  let servingsHint: number | null = null;
  let kcalHint: number | null = null;
  let instructionsHint: string | null = null;

  if (input.url) {
    const u = safeUrl(input.url);
    if (!u) throw new InputError(400, "Linket ser ikke ud til at være en almindelig webadresse.");
    let html: string, viaReader: boolean;
    try { ({ html, viaReader } = await fetchPage(u)); }
    catch { throw new InputError(422, "Siden kunne ikke hentes. Den kræver måske login. Kopiér opskriftens tekst og indsæt den i stedet."); }
    if (viaReader) {
      prompt = `Tekst fra opskriftssiden ${u.hostname} (kan indeholde menuer og reklamer):\n${html.slice(0, 20000)}`;
      const r0 = await askClaude(prompt);
      return r0;
    }
    const structured = extractJsonLdRecipe(html);
    image = structured?.image ?? metaContent(html, "og:image");
    pageTitle = structured?.title ?? metaContent(html, "og:title");
    if (structured) {
      servingsHint = structured.servings;
      kcalHint = structured.kcal;
      instructionsHint = structured.instructions;
      prompt = `Opskrift: ${structured.title ?? ""}\nAntal: ${structured.servings ?? "ukendt"}\n` +
        (structured.kcal ? `Kalorier pr. portion ifølge siden: ${structured.kcal}\n` : "") +
        `Ingredienser:\n${structured.ingredients.join("\n")}\n\n(Fremgangsmåden er allerede gemt, så sæt instructions til null.)`;
    } else {
      const desc = metaContent(html, "og:description") ?? metaContent(html, "description") ?? "";
      const body = SOCIAL.test(u.hostname) ? "" : pageText(html);
      if (!desc && !body) return { title: pageTitle, servings: null, image, items: [], kcal_per_serving: null, instructions: null };
      prompt = `Tekst fra ${u.hostname} (kan være en billedtekst fra sociale medier eller en side med menuer og reklamer):\nTitel: ${pageTitle ?? ""}\n${desc}\n\n${body}`;
    }
  } else if (input.text && input.text.trim().length > 5) {
    prompt = `Tekst kopieret fra en opskrift (kan indeholde menuer og reklamer):\n${input.text.slice(0, 20000)}`;
  } else if (input.image) {
    prompt = "Billedet viser en opskrift, fx fra en kogebog. Læs ingredienserne.";
  } else {
    throw new InputError(400, "Send et link, en tekst eller et billede.");
  }

  const r = await askClaude(prompt, input.image);
  return {
    title: r.title || pageTitle,
    servings: r.servings ?? servingsHint,
    image,
    items: r.items,
    kcal_per_serving: kcalHint ?? r.kcal_per_serving,
    instructions: instructionsHint ?? r.instructions,
  };
}

async function askClaude(prompt: string, image?: ImageInput | null): Promise<Extracted> {
  const r = await claudeStructured<ClaudeRecipe>({
    system: RECIPE_SYSTEM,
    text: prompt,
    images: image ? [image] : undefined,
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
  const kcal = typeof r.kcal_per_serving === "number" && r.kcal_per_serving > 20 && r.kcal_per_serving < 5000 ? Math.round(r.kcal_per_serving) : null;
  const instructions = typeof r.instructions === "string" && r.instructions.trim() ? r.instructions.trim().slice(0, 8000) : null;
  return { title: r.title?.trim() || null, servings: r.servings ?? null, image: null, items, kcal_per_serving: items.length ? kcal : null, instructions };
}
