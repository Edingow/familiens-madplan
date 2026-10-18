import type { Nutrition } from "../lib/types";

const g = (n: number) => `${Math.round(n)} g`;

/** Næring pr. person med kildeangivelse til Frida, som vilkårene kræver. */
export function NutritionLine({ n, kcal }: { n: Nutrition | null; kcal: number | null }) {
  if (n) {
    return (
      <span className="small" style={{ display: "grid", gap: 2 }}>
        <span><b>Ca. {n.kcal} kcal</b> pr. person · {g(n.protein)} protein · {g(n.fat)} fedt · {g(n.carbs)} kulhydrat · {g(n.fiber)} fibre</span>
        <span className="muted" style={{ fontSize: ".74rem" }}>
          Næringsdata: Fødevaredata (frida.fooddata.dk), version 5.5{n.coverage < 0.8 ? ". Nogle ingredienser blev ikke fundet, så tallene er lidt for lave" : ""}
        </span>
      </span>
    );
  }
  if (kcal) return <span className="small"><b>Ca. {kcal} kcal</b> pr. person (skøn)</span>;
  return null;
}
