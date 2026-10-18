import type { VercelRequest, VercelResponse } from "@vercel/node";
import { claudeStructured, UserFacingError } from "./_lib/claude.js";
import { fail, requireUser } from "./_lib/http.js";

export const config = { maxDuration: 60 };

interface InDish { title: string; day: string | null; kcal: number | null; servings: number | null; items: string[] }
export interface PlanAssessment {
  rating: "god" | "middel" | "mindre god";
  summary: string;
  points: { kind: "plus" | "minus"; text: string }[];
}

const SYSTEM = `Du vurderer en dansk families madplan for ugen ud fra Fødevarestyrelsens officielle kostråd:
- Spis mange grøntsager og frugt, gerne grove grøntsager og bælgfrugter.
- Spis fisk to gange om ugen, gerne fed fisk.
- Begræns rødt kød (okse, svin, lam) til højst ca. 350 g tilberedt pr. person om ugen, og spis mindre forarbejdet kød (pølser, bacon, pålæg).
- Vælg fuldkorn frem for hvidt mel, hvid pasta og hvide ris.
- Vælg magre mejeriprodukter, og spar på fløde, ost og smør.
- Variation er godt.
Vurder hele ugen samlet ud fra retternes navne, ingredienser og kalorieskøn.

Svar på dansk, kort og venligt, som en hjælpsom ven, der kender kostrådene. Ingen løftede pegefingre.
- rating: "god", "middel" eller "mindre god".
- summary: én sætning, der opsummerer ugen.
- points: 2-4 konkrete punkter. "plus" for det, der er godt, "minus" for det, der kan forbedres, med et konkret forslag, fx "Byt torsdagens pasta til fuldkornspasta".
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
        properties: { kind: { type: "string", enum: ["plus", "minus"] }, text: { type: "string" } },
        required: ["kind", "text"],
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

  const text = "Ugens madplan:\n" + dishes.map((d) =>
    `- ${d.day ?? "Uden dag"}: ${String(d.title).slice(0, 120)}` +
    (d.kcal ? ` (ca. ${d.kcal} kcal pr. person)` : "") +
    (d.items?.length ? `\n  Ingredienser: ${d.items.slice(0, 40).map((x) => String(x).slice(0, 60)).join(", ")}` : "\n  Ingredienser: ukendt"),
  ).join("\n");

  try {
    const r = await claudeStructured<PlanAssessment>({ system: SYSTEM, text, toolName: "vurdering", schema: SCHEMA, maxTokens: 800 });
    const out: PlanAssessment = {
      rating: ["god", "middel", "mindre god"].includes(r.rating) ? r.rating : "middel",
      summary: String(r.summary || "").slice(0, 300),
      points: (r.points || []).slice(0, 4).map((p) => ({ kind: p.kind === "plus" ? "plus" : "minus", text: String(p.text).slice(0, 200) })),
    };
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    fail(res, 500, e instanceof UserFacingError ? e.message : "Madplanen kunne ikke vurderes lige nu. Prøv igen om lidt.");
  }
}
