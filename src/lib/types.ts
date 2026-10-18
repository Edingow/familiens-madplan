export type Category =
  | "frugt" | "brod" | "kod" | "mejeri" | "kol" | "kolonial"
  | "krydderi" | "frost" | "drikke" | "andet";

export const CATEGORY_NAMES: Record<Category | "basic", string> = {
  frugt: "Frugt & grønt",
  brod: "Brød & bageri",
  kod: "Kød & fisk",
  mejeri: "Mejeri & æg",
  kol: "Køl & pålæg",
  kolonial: "Kolonial",
  krydderi: "Krydderier, olie & saucer",
  frost: "Frost",
  drikke: "Drikkevarer",
  andet: "Andet",
  basic: "Har I det hjemme?",
};

export const DEFAULT_ORDER: Category[] = [
  "frugt", "brod", "kod", "mejeri", "kol", "kolonial", "krydderi", "frost", "drikke", "andet",
];

export interface Ingredient {
  name: string;
  qty: number | null;
  unit: string;
  category: Category;
  basic?: boolean;
  /** Sat når familien har den hjemme og den ikke skal på listen. */
  off?: boolean;
}

export interface ParsedRecipe {
  title: string;
  servings: number | null;
  image: string | null;
  items: Ingredient[];
  kcal_per_serving: number | null;
  instructions: string | null;
}

export interface Product {
  found: boolean;
  name: string;
  qty: number | null;
  unit: string;
  category: Category;
}

export type Role = "parent" | "child";
export type DishStatus = "voting" | "planned" | "done";

export interface Family {
  id: string;
  name: string;
  parent_code: string;
  child_code: string;
  category_order: Category[];
  plan_vote_open: boolean;
  plan_vote_sent_at: string | null;
  plan_assessment: PlanAssessment | null;
  plan_assessed_at: string | null;
}

export interface PlanAssessment {
  rating: "god" | "middel" | "mindre god";
  summary: string;
  points: { kind: "plus" | "minus"; text: string }[];
  /** Hvilke retter vurderingen gjaldt, så appen kan se, om madplanen er ændret siden. */
  dishIds?: string;
}

export interface Member {
  family_id: string;
  user_id: string;
  display_name: string;
  role: Role;
}

export interface Recipe {
  id: string;
  family_id: string;
  title: string;
  url: string | null;
  image: string | null;
  note: string | null;
  servings_base: number | null;
  items: Ingredient[];
  suggested: boolean;
  kcal_per_serving: number | null;
  instructions: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Dish {
  id: string;
  recipe_id: string | null;
  kcal_per_serving: number | null;
  family_id: string;
  title: string;
  url: string | null;
  image: string | null;
  note: string | null;
  servings_base: number | null;
  servings: number | null;
  items: Ingredient[];
  status: DishStatus;
  plan_date: string | null;
  vote_deadline: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Vote {
  dish_id: string;
  user_id: string;
  value: 1 | -1;
  comment: string | null;
  suggestion_recipe_id: string | null;
}

export interface TemplateItem {
  name: string;
  qty: number | null;
  unit: string;
  category: Category;
}

export interface ShoppingTemplate {
  id: string;
  family_id: string;
  name: string;
  items: TemplateItem[];
  created_at: string;
}

export interface PlanReview {
  family_id: string;
  user_id: string;
  reviewed_at: string;
}

export interface Extra {
  id: string;
  family_id: string;
  name: string;
  qty: number | null;
  unit: string;
  category: Category;
  created_by: string | null;
  created_at: string;
}

export const CATEGORIES = new Set<string>(DEFAULT_ORDER);
export function asCategory(c: unknown): Category {
  return typeof c === "string" && CATEGORIES.has(c) ? (c as Category) : "andet";
}
