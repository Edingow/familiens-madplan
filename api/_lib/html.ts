/** Læsning af opskriftssider: struktureret opskriftsdata (schema.org) og ren tekst som reserve. */

export interface PageRecipe {
  title: string | null;
  servings: number | null;
  image: string | null;
  ingredients: string[];
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function isRecipe(node: any): boolean {
  const t = node?.["@type"];
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
}

function findRecipe(node: any, depth = 0): any | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipe(n, depth + 1); if (r) return r; }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipe(node[k], depth + 1);
    if (r) return r;
  }
  return null;
}

function parseYield(y: unknown): number | null {
  const v = Array.isArray(y) ? y[0] : y;
  if (typeof v === "number") return v > 0 ? v : null;
  if (typeof v === "string") { const m = v.match(/\d+/); return m ? Number(m[0]) : null; }
  return null;
}

function imageOf(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return imageOf(img[0]);
  if (typeof img === "object" && typeof (img as any).url === "string") return (img as any).url;
  return null;
}

export function extractJsonLdRecipe(html: string): PageRecipe | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const r = findRecipe(data);
    if (!r) continue;
    const ingredients: string[] = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : [])
      .filter((x: unknown) => typeof x === "string")
      .map((x: string) => decode(x).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!ingredients.length) continue;
    return {
      title: typeof r.name === "string" ? decode(r.name).trim() : null,
      servings: parseYield(r.recipeYield),
      image: imageOf(r.image),
      ingredients,
    };
  }
  return null;
}

export function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decode(c).trim() : null;
}

/** Synlig tekst fra siden uden scripts, menuer og sidefødder. */
export function pageText(html: string, maxChars = 20000): string {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(body).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n+/g, "\n").trim().slice(0, maxChars);
}
