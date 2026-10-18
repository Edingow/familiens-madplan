import { callApi, supabase } from "./supabase";
import type { Dish, PlanAssessment } from "./types";
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
      servings: d.servings,
      items: d.items.filter((i) => !i.off).map((i) => i.name),
    })),
  });
  const { error } = await supabase.from("families")
    .update({ plan_assessment: { ...result, dishIds: plannedIds(data.dishes) }, plan_assessed_at: new Date().toISOString() })
    .eq("id", data.family!.id);
  if (error) throw error;
}
