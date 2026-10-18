import type { VercelRequest, VercelResponse } from "@vercel/node";
import { claudeStructured, UserFacingError } from "./_lib/claude.js";
import { fail, requireUser } from "./_lib/http.js";

export const config = { maxDuration: 60 };

interface InDish { title: string; day: string | null; kcal: number | null; servings: number | null; items: string[]; nutrition?: { protein: number; fat: number; carbs: number; fiber: number } | null }
interface Swap { from: string; to: string; category: string }
export interface PlanAssessment {
  rating: "god" | "middel" | "mindre god";
  summary: string;
  points: { kind: "plus" | "minus"; text: string; dish?: number | null; swaps?: Swap[] }[];
}

const SYSTEM = `Du vurderer en dansk families madplan for ugen ud fra Fødevarestyrelsens officielle kostråd:
- Spis mange grøntsager og frugt, gerne grove grøntsager og bælgfrugter.
- Spis fisk to gange om ugen, gerne fed fisk.
- Begræns rødt kød (okse, svin, lam) til højst ca. 350 g tilberedt pr. person om ugen, og spis mindre forarbejdet kød (pølser, bacon, pålæg).
- Vælg fuldkorn frem for hvidt mel, hvid pasta og hvide ris.
- Vælg magre mejeriprodukter, og spar på fløde, ost og smør.
- Variation er godt.
Vurder hele ugen samlet ud fra retternes navne, ingredienser, kalorier og næringsindhold, når det er oplyst.

Svar på dansk, kort og venligt, som en hjælpsom ven, der kender kostrådene. Ingen løftede pegefingre.
- rating: "god", "middel" eller "mindre god".
- summary: én sætning, der opsummerer ugen.
- points: 2-4 konkrete punkter. "plus" for det, der er godt, "minus" for det, der kan forbedres, med et konkret forslag, fx "Byt torsdagens pasta til fuldkornspasta".
- Når et minus kan løses ved at bytte ingredienser i én ret, så udfyld dish med rettens nummer fra listen og swaps med de ombytninger, der skal ske. from skal være præcis en ingrediens fra rettens liste, to er den nye ingrediens på dansk med små bogstaver, og category er dens afdeling (frugt, brod, kod, mejeri, kol, kolonial, krydderi, frost, drikke, andet). Mængden bevares. Kan forslaget ikke løses med en ombytning, så lad dish være null og swaps være tom.
Brug ikke tankestreger.`;

const SCHEMA = {
  type: "object",
  properties: {
    rating: { type: "string", enum: ["god", "middel", "mindre god"] },
    summary: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["plus", "minus"] },
          text: { type: "string" },
          dish: { type: ["integer", "null"] },
          swaps: {
            type: "array",
            items: {
              type: "object",
              properties: { from: { type: "string" }, to: { type: "string" }, category: { type: "string" } },
              required: ["from", "to", "category"],
            },
          },
        },
        required: ["kind", "text", "dish", "swaps"],
      },
    },
  },
  required: ["rating", "summary", "points"],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return fail(res, 405, "Brug POST");
  if (!(await requireUser(req, res))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const dishes: InDish[] = Array.isArray(body.dishes) ? body.dishes.slice(0, 21) : [];
  if (!dishes.length) return fail(res, 400, "Madplanen er tom.");

  const text = "Ugens madplan:\n" + dishes.map((d, i) =>
    `${i + 1}. ${d.day ?? "Uden dag"}: ${String(d.title).slice(0, 120)}` +
    (d.kcal ? ` (ca. ${d.kcal} kcal pr. person)` : "") +
    (d.nutrition ? ` [pr. person: ${Math.round(d.nutrition.protein)} g protein, ${Math.round(d.nutrition.fat)} g fedt, ${Math.round(d.nutrition.carbs)} g kulhydrat, ${Math.round(d.nutrition.fiber)} g fibre]` : "") +
    (d.items?.length ? `\n  Ingredienser: ${d.items.slice(0, 40).map((x) => String(x).slice(0, 60)).join(", ")}` : "\n  Ingredienser: ukendt"),
  ).join("\n");

  try {
    const r = await claudeStructured<PlanAssessment>({ system: SYSTEM, text, toolName: "vurdering", schema: SCHEMA, maxTokens: 800 });
    const out: PlanAssessment = {
      rating: ["god", "middel", "mindre god"].includes(r.rating) ? r.rating : "middel",
      summary: String(r.summary || "").slice(0, 300),
      points: (r.points || []).slice(0, 4).map((p) => {
        const kind = p.kind === "plus" ? "plus" as const : "minus" as const;
        const dish = kind === "minus" && Number.isInteger(p.dish) && p.dish! >= 1 && p.dish! <= dishes.length ? p.dish! : null;
        const swaps = dish ? (p.swaps || []).slice(0, 5).map((w) => ({ from: String(w.from).toLowerCase().trim(), to: String(w.to).toLowerCase().trim(), category: String(w.category) }))
          .filter((w) => w.from && w.to && dishes[dish - 1].items.some((x) => x.toLowerCase().trim() === w.from)) : [];
        return { kind, text: String(p.text).slice(0, 200), dish: swaps.length ? dish : null, swaps };
      }),
    };
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    fail(res, 500, e instanceof UserFacingError ? e.message : "Madplanen kunne ikke vurderes lige nu. Prøv igen om lidt.");
  }
}
