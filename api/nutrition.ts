import type { VercelRequest, VercelResponse } from "@vercel/node";
import { UserFacingError } from "./_lib/claude.js";
import { fail, requireUser } from "./_lib/http.js";
import { computeNutrition } from "./_lib/nutrition.js";
import { asCategory, type Ingredient } from "../src/lib/types.js";

export const config = { maxDuration: 60 };

/** Regn næringsindhold pr. person ud for en opskrift, der allerede er gemt. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return fail(res, 405, "Brug POST");
  if (!(await requireUser(req, res))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const items: Ingredient[] = (Array.isArray(body.items) ? body.items : []).slice(0, 40)
    .filter((i: any) => i && typeof i.name === "string")
    .map((i: any) => ({ name: String(i.name).slice(0, 80), qty: typeof i.qty === "number" ? i.qty : null, unit: String(i.unit || ""), category: asCategory(i.category), off: !!i.off }));
  if (!items.length) return fail(res, 400, "Opskriften har ingen ingredienser.");
  try {
    const n = await computeNutrition(items, typeof body.servings === "number" ? body.servings : null);
    if (!n) return fail(res, 422, "Ingredienserne kunne ikke findes i Frida.");
    res.status(200).json(n);
  } catch (e) {
    console.error(e);
    fail(res, 500, e instanceof UserFacingError ? e.message : "Næringsindholdet kunne ikke regnes ud lige nu.");
  }
}
