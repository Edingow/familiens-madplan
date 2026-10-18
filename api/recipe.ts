import type { VercelRequest, VercelResponse } from "@vercel/node";
import { UserFacingError } from "./_lib/claude.js";
import { extractRecipe, InputError } from "./_lib/extract.js";
import { fail, readImage, requireUser } from "./_lib/http.js";
import type { ParsedRecipe } from "../src/lib/types.js";

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return fail(res, 405, "Brug POST");
  if (!(await requireUser(req, res))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  try {
    const r = await extractRecipe({ url: body.url, text: typeof body.text === "string" ? body.text : undefined, image: readImage(body) });
    if (!r.items.length) return fail(res, 422, "Der blev ikke fundet nogen ingredienser. Prøv at indsætte selve ingredienslisten.");
    const out: ParsedRecipe = {
      title: r.title || "Opskrift", servings: r.servings, image: r.image, items: r.items,
      kcal_per_serving: r.kcal_per_serving, instructions: r.instructions,
    };
    res.status(200).json(out);
  } catch (e) {
    if (e instanceof InputError) return fail(res, e.status, e.message);
    console.error(e);
    fail(res, 500, e instanceof UserFacingError ? e.message : "Opskriften kunne ikke læses lige nu. Prøv igen om lidt.");
  }
}
