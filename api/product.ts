import type { VercelRequest, VercelResponse } from "@vercel/node";
import { claudeStructured, UserFacingError, PRODUCT_SCHEMA, PRODUCT_SYSTEM } from "./_lib/claude.js";
import { fail, readImage, requireUser } from "./_lib/http.js";
import { asCategory, type Product } from "../src/lib/types.js";

export const config = { maxDuration: 30 };

async function openFoodFacts(code: string): Promise<Record<string, unknown> | null> {
  const fields = "product_name,product_name_da,generic_name_da,brands,quantity,categories_tags";
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, {
    headers: { "user-agent": "FamiliensMadplan/1.0 (privat familieapp)" },
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d?.status !== 1 || !d.product) return null;
  const p = d.product;
  if (!p.product_name && !p.product_name_da && !p.brands) return null;
  return p;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return fail(res, 405, "Brug POST");
  if (!(await requireUser(req, res))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  try {
    let text: string;
    const img = readImage(body);
    if (typeof body.barcode === "string" && /^\d{6,14}$/.test(body.barcode)) {
      const p = await openFoodFacts(body.barcode);
      if (!p) return res.status(200).json({ found: false, name: "", qty: null, unit: "", category: "andet", reason: "unknown_barcode" });
      text = `Data fra varedatabasen Open Food Facts for stregkode ${body.barcode}:\n${JSON.stringify(p)}`;
    } else if (img) {
      text = "Billedet er taget af en emballage eller en vare, som familien er ved at løbe tør for. Find ud af præcis hvilken vare det er.";
    } else {
      return fail(res, 400, "Send en stregkode eller et billede.");
    }

    const r = await claudeStructured<Product>({
      system: PRODUCT_SYSTEM, text, images: img ? [img] : undefined,
      toolName: "gem_vare", schema: PRODUCT_SCHEMA, maxTokens: 500,
    });
    const out: Product = {
      found: !!r.found && !!r.name?.trim(),
      name: (r.name || "").trim(),
      qty: typeof r.qty === "number" && isFinite(r.qty) ? r.qty : null,
      unit: typeof r.unit === "string" ? r.unit : "",
      category: asCategory(r.category),
    };
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    fail(res, 500, e instanceof UserFacingError ? e.message : "Varen kunne ikke slås op lige nu. Prøv igen om lidt.");
  }
}
