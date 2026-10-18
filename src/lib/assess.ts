import { callApi, supabase } from "./supabase";
import { asCategory, type Dish, type PlanAssessment } from "./types";
import { keyOf } from "./merge";
import type { FamilyData } from "./useFamily";
import { dayLabel } from "./util";

export const plannedIds = (dishes: Dish[]) =>
  dishes.filter((d) => d.status === "planned").map((d) => d.id).sort().join(",");

/** Lad Claude vurdere ugens madplan og gem vurderingen, så hele familien kan se den. */
export async function assessPlan(data: FamilyData): Promise<void> {
  const planned = data.dishes
    .filter((d) => d.status === "planned")
    .sort((a, b) => (a.plan_date ?? "9999").localeCompare(b.plan_date ?? "9999"));
  const result = await callApi<PlanAssessment>("/api/plan-review", {
    dishes: planned.map((d) => ({
      title: d.title,
      day: d.plan_date ? dayLabel(d.plan_date) : null,
      kcal: d.kcal_per_serving ?? data.recipes.find((r) => r.id === d.recipe_id)?.kcal_per_serving ?? null,
      nutrition: d.nutrition ?? data.recipes.find((r) => r.id === d.recipe_id)?.nutrition ?? null,
      servings: d.servings,
      items: d.items.filter((i) => !i.off).map((i) => i.name),
    })),
  });
  // Oversæt rettens nummer til dens id, så forslaget kan føres ud i livet senere.
  const points = result.points.map((p) => ({ ...p, dishId: p.dish ? planned[p.dish - 1]?.id ?? null : null }));
  const { error } = await supabase.from("families")
    .update({ plan_assessment: { ...result, points, dishIds: plannedIds(data.dishes) }, plan_assessed_at: new Date().toISOString() })
    .eq("id", data.family!.id);
  if (error) throw error;
}

/** Acceptér et forslag: byt ingredienserne i retten og markér forslaget. */
export async function decidePoint(data: FamilyData, index: number, accept: boolean): Promise<void> {
  const a = data.family!.plan_assessment!;
  const p = a.points[index];
  if (accept && p.dishId && p.swaps?.length) {
    const dish = data.dishes.find((d) => d.id === p.dishId);
    if (!dish) throw new Error("Retten er ikke længere på madplanen.");
    const items = dish.items.map((it) => {
      const w = p.swaps!.find((x) => keyOf(x.from) === keyOf(it.name));
      return w ? { ...it, name: w.to, category: asCategory(w.category) } : it;
    });
    const { error } = await supabase.from("dishes").update({ items }).eq("id", dish.id);
    if (error) throw error;
  }
  const points = a.points.map((x, i) => (i === index ? { ...x, status: accept ? "accepted" as const : "rejected" as const } : x));
  const { error } = await supabase.from("families").update({ plan_assessment: { ...a, points } }).eq("id", data.family!.id);
  if (error) throw error;
}
