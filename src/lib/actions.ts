import { supabase } from "./supabase";
import type { Recipe } from "./types";
import { defaultDeadline } from "./util";

/** Læg en opskrift fra kogebogen på madplanen eller til afstemning. Ingredienserne kopieres, så hver uge kan tilpasses. */
export async function planRecipe(recipe: Recipe, userId: string, opts: { status: "planned" | "voting"; date?: string; servings?: number | null }) {
  const { error } = await supabase.from("dishes").insert({
    family_id: recipe.family_id,
    recipe_id: recipe.id,
    title: recipe.title,
    url: recipe.url,
    image: recipe.image,
    note: recipe.note,
    servings_base: recipe.servings_base,
    servings: opts.servings ?? recipe.servings_base,
    items: recipe.items.map(({ off: _off, ...i }) => i),
    status: opts.status,
    plan_date: opts.status === "planned" && opts.date ? opts.date : null,
    vote_deadline: opts.status === "voting" ? defaultDeadline().toISOString() : null,
    created_by: userId,
  });
  if (error) throw error;
}
