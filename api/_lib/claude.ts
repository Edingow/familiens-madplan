/** Kald til Claudes API med tvunget struktureret svar (tool use). */

const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

/** Fejl, hvis tekst er sikker og nyttig at vise i appen. */
export class UserFacingError extends Error {}

export type ImageInput = { mediaType: string; base64: string };

export async function claudeStructured<T>(opts: {
  system: string;
  text: string;
  images?: ImageInput[];
  toolName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new UserFacingError("ANTHROPIC_API_KEY mangler i Vercel.");
  const content: unknown[] = (opts.images || []).map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
  content.push({ type: "text", text: opts.text });

  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      tools: [{ name: opts.toolName, description: "Gem resultatet", input_schema: opts.schema }],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const raw = (await res.text()).slice(0, 500);
    console.error("Claude API", res.status, raw);
    let detail = "";
    try { detail = JSON.parse(raw)?.error?.message ?? ""; } catch { /* ikke JSON */ }
    let msg = `Claude svarede med fejl ${res.status}${detail ? `: ${detail}` : "."}`;
    if (res.status === 401) msg = "Anthropic-nøglen virker ikke. Tjek ANTHROPIC_API_KEY i Vercel.";
    else if (/credit balance/i.test(raw)) msg = "Der er ingen kredit tilbage på Anthropic-kontoen.";
    else if (res.status === 404) msg = `Claude-modellen ${MODEL} blev ikke fundet.`;
    else if (res.status === 429 || res.status === 529) msg = "Claude har travlt lige nu. Prøv igen om lidt.";
    throw new UserFacingError(msg);
  }
  const data = await res.json();
  const block = (data.content || []).find((b: any) => b.type === "tool_use");
  if (!block) throw new Error("Claude gav intet struktureret svar");
  return block.input as T;
}

const CATEGORY_GUIDE =
  "category er én af: frugt (frugt, grønt, friske krydderurter), brod, kod (kød og fisk), mejeri (mælk, fløde, ost, smør, æg), " +
  "kol (pålæg, tofu, frisk pasta, færdigdej), kolonial (pasta, ris, mel, sukker, dåser, bagevarer, nødder, kaffe), " +
  "krydderi (tørrede krydderier, olie, eddike, saucer, bouillon), frost, drikke, andet (rengøring, hygiejne, toiletpapir m.m.).";

export const RECIPE_SYSTEM = `Du læser opskrifter for en dansk familie og laver en indkøbsliste ud fra dem.
Regler for ingredienser:
- name: kort dansk indkøbsnavn i grundform med små bogstaver, uden tilberedning og mængdeord. Fx "løg", "rødløg", "hvidløg", "hakket oksekød", "flåede tomater", "piskefløde", "parmesan". Brug altid samme navn for samme vare, så den kan lægges sammen med andre opskrifter.
- qty: tal (brøker som decimaltal) eller null.
- unit: én af g, kg, ml, dl, l, tsk, spsk, stk, fed, dåse, pakke, bundt eller tom streng. Omregn amerikanske mål: 1 cup = 2,4 dl, 1 oz = 28 g, 1 lb = 450 g, tbsp = spsk, tsp = tsk.
- Samme ingrediens flere steder i opskriften lægges sammen til én linje. Udelad vand.
- ${CATEGORY_GUIDE}
- basic er true kun for salt, peber, madolie og andre små mængder af ting næsten alle har i skabet.
- title er en kort dansk titel. servings er antal personer/portioner, ellers null.
- kcal_per_serving: dit bedste skøn over kalorier pr. portion ud fra ingredienserne og mængderne, afrundet til nærmeste 10. Står der et tal fra siden, så brug det. null hvis det ikke kan skønnes.
Oversæt alt til dansk.`;

export const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "false hvis der ikke er en opskrift" },
    title: { type: "string" },
    servings: { type: ["integer", "null"] },
    kcal_per_serving: { type: ["integer", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: ["number", "null"] },
          unit: { type: "string" },
          category: { type: "string", enum: ["frugt", "brod", "kod", "mejeri", "kol", "kolonial", "krydderi", "frost", "drikke", "andet"] },
          basic: { type: "boolean" },
        },
        required: ["name", "qty", "unit", "category", "basic"],
      },
    },
  },
  required: ["found", "title", "servings", "items"],
};

export const PRODUCT_SYSTEM = `Du identificerer dagligvarer for en dansk familie, så de kan købe varen igen.
- name: varens navn som i butikken, med mærke og variant, fx "Arla Letmælk", "Lurpak Smørbar Let". Kun et generisk navn hvis mærket ikke kan ses.
- qty og unit: pakningsstørrelsen, fx 1 og "l", 500 og "g". unit er én af g, kg, ml, dl, l, stk, pakke, dåse eller tom streng.
- ${CATEGORY_GUIDE}
- found er false, hvis billedet eller data ikke viser en genkendelig vare.`;

export const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    qty: { type: ["number", "null"] },
    unit: { type: "string" },
    category: { type: "string", enum: ["frugt", "brod", "kod", "mejeri", "kol", "kolonial", "krydderi", "frost", "drikke", "andet"] },
  },
  required: ["found", "name", "qty", "unit", "category"],
};
