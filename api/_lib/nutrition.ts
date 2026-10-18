import { FOODS, FRIDA_SOURCE } from "./frida-data.js";
import { claudeStructured } from "./claude.js";
import type { Ingredient, Nutrition } from "../../src/lib/types.js";

export { FRIDA_SOURCE };

const norm = (s: string) => s.toLowerCase().replace(/[^a-zæøå0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 1);
const FOOD_TOKENS = FOODS.map((f) => tokens(f[1]));
// Tilberedte retter og fastfood er sjældent det, en opskrift mener med en råvare.
const DISH_WORDS = /fastfood|takeaway|sandwich|burger|pizza|kage|is af|salat med|i flødesovs|friturestegt|pålæg|dybfrost|instant|pulver|spædbørn|modermælk|chokolade/;
const VOCAB = new Set(FOOD_TOKENS.flat());

/** Del sammensatte ord i kendte dele: "kyllingebouillon" giver også "kylling" og "bouillon". */
function expand(ts: string[]): string[] {
  const out = [...ts];
  for (const t of ts) {
    if (t.length < 7) continue;
    for (let i = 3; i <= t.length - 3; i++) {
      const left = t.slice(0, i).replace(/[es]$/, ""), right = t.slice(i);
      if (left.length >= 3 && VOCAB.has(left) && VOCAB.has(right)) { out.push(left, right); break; }
    }
  }
  return out;
}

const stem = (t: string) => t.replace(/(ede|ene|ere|et|te|ne|er|en|e)$/, "");

function tokenScore(ing: string, food: string): number {
  if (ing === food) return 3;
  if (ing.length >= 4 && food.length >= 4 && (ing.startsWith(food) || food.startsWith(ing))) return 2;
  if (stem(ing).length >= 3 && stem(ing) === stem(food)) return 2;
  // Fødevarens ord ender på ingrediensen: "letmælk" og "sødmælk" er mælk.
  if (ing.length >= 4 && food.endsWith(ing)) return 2.5;
  // Sammensatte ord: "kyllingebryst" indeholder "kylling", "letmælk" indeholder "mælk".
  if (food.length >= 4 && ing.includes(food)) return 1.5;
  if (ing.length >= 4 && food.includes(ing)) return 1;
  return 0;
}

/** De Frida-fødevarer, der ligner en ingrediens mest. */
export function candidates(name: string, n = 15): { id: number; name: string }[] {
  const it = expand(tokens(name));
  if (!it.length) return [];
  const whole = it.join("");
  const scored: { i: number; s: number }[] = [];
  FOOD_TOKENS.forEach((ft, i) => {
    let s = 0;
    for (const a of it) s += Math.max(0, ...ft.map((b) => tokenScore(a, b)));
    if (s <= 0) return;
    // Belønning for hvert ord i fødevarens navn, der også står i ingrediensen ("kylling" og "bryst" i "kyllingebryst").
    for (const b of ft) if (b.length >= 4 && whole.includes(b)) s += 0.7;
    const fname = FOODS[i][1].toLowerCase();
    if (/, (rå|råt)\b/.test(fname) || /, rå$/.test(fname)) s += 0.6;
    if (DISH_WORDS.test(fname)) s -= 1;
    s -= ft.length * 0.08;
    scored.push({ i, s });
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map(({ i }) => ({ id: FOODS[i][0], name: FOODS[i][1] }));
}

interface Pick { index: number; id: number | null; grams: number | null }

/** Slå hver ingrediens op i Frida og regn næringsindhold pr. person ud. */
export async function computeNutrition(items: Ingredient[], servings: number | null): Promise<Nutrition | null> {
  const use = items.filter((i) => !i.off).slice(0, 40);
  if (!use.length) return null;
  const lines = use.map((it, i) => {
    const amount = [it.qty ?? "", it.unit].join(" ").trim() || "ingen mængde";
    const cands = candidates(it.name).map((c) => `${c.id}: ${c.name}`).join("; ");
    return `${i + 1}. ${it.name} (${amount})\n   Kandidater: ${cands || "ingen"}`;
  }).join("\n");

  const r = await claudeStructured<{ picks: Pick[] }>({
    system: `Du matcher ingredienser fra en opskrift med fødevarer i den danske fødevaredatabase Frida og skønner vægten.
For hver ingrediens:
- id: den kandidat, der bedst svarer til råvaren, som den købes (fx rå, ikke tilberedt). null hvis ingen kandidat passer rimeligt.
- grams: dit skøn over vægten i gram for den angivne mængde (fx 1 stk løg ca. 120 g, 1 fed hvidløg ca. 5 g, 1 dl fløde ca. 100 g, 1 spsk olie ca. 13 g). Uden mængde: en typisk mængde i en opskrift, fx salt 3 g.`,
    text: `Opskriften er til ${servings ?? "ukendt antal"} personer.\n${lines}`,
    toolName: "match",
    schema: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: { index: { type: "integer" }, id: { type: ["integer", "null"] }, grams: { type: ["number", "null"] } },
            required: ["index", "id", "grams"],
          },
        },
      },
      required: ["picks"],
    },
    maxTokens: 2000,
  });

  const byId = new Map(FOODS.map((f) => [f[0], f]));
  const total = { kcal: 0, protein: 0, carbs: 0, fiber: 0, fat: 0, salt: 0 };
  let matched = 0;
  for (const p of r.picks || []) {
    const it = use[p.index - 1];
    const f = p.id != null ? byId.get(p.id) : undefined;
    const g = typeof p.grams === "number" && p.grams > 0 && p.grams < 5000 ? p.grams : null;
    if (!it || !f || !g) continue;
    // Kun kandidater, vi selv har foreslået, så et forkert id ikke smutter igennem.
    if (!candidates(it.name).some((c) => c.id === f[0])) continue;
    matched++;
    total.kcal += (f[2] ?? 0) * g / 100;
    total.protein += (f[3] ?? 0) * g / 100;
    total.carbs += (f[4] ?? 0) * g / 100;
    total.fiber += (f[5] ?? 0) * g / 100;
    total.fat += (f[6] ?? 0) * g / 100;
    total.salt += (f[7] ?? 0) * g / 100;
  }
  if (!matched) return null;
  const per = Math.max(1, servings || 1);
  const r1 = (n: number) => Math.round(n / per * 10) / 10;
  return {
    kcal: Math.round(total.kcal / per / 10) * 10,
    protein: r1(total.protein),
    carbs: r1(total.carbs),
    fat: r1(total.fat),
    fiber: r1(total.fiber),
    salt: r1(total.salt),
    coverage: Math.round((matched / use.length) * 100) / 100,
    source: "frida",
  };
}
