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
}

export interface Member {
  family_id: string;
  user_id: string;
  display_name: string;
  role: Role;
}

export interface Dish {
  id: string;
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
