import { DishCard } from "../components/DishCard";
import type { Dish } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { dayLabel, nextDays } from "../lib/util";

interface Props { data: FamilyData; userId: string; onFill: (d: Dish) => void; onChanged: () => void; openAdd: () => void }

export function MealPlan({ data, userId, onFill, onChanged, openAdd }: Props) {
  const planned = data.dishes.filter((d) => d.status === "planned");
  const days = nextDays();
  const dayIsos = new Set(days.map((d) => d.iso));
  const undated = planned.filter((d) => !d.plan_date || !dayIsos.has(d.plan_date));
  const card = (d: Dish) => <DishCard key={d.id} dish={d} data={data} userId={userId} onFill={onFill} onChanged={onChanged} />;

  if (!planned.length) {
    return (
      <div className="empty">
        <h2>Madplanen er tom</h2>
        <p>Læg retter direkte på madplanen, eller send dem til afstemning, så hele familien kan være med til at vælge.</p>
        <button className="btn" onClick={openAdd}>Tilføj en ret</button>
      </div>
    );
  }

  return (
    <>
      {days.map((d) => {
        const list = planned.filter((x) => x.plan_date === d.iso);
        return (
          <div className="day" key={d.iso}>
            <div className="day-label">{d.label}</div>
            {list.length ? list.map(card) : <div className="empty-day">Ingen ret valgt</div>}
          </div>
        );
      })}
      {undated.length > 0 && (
        <div className="day">
          <div className="day-label">Ugens retter uden dag</div>
          {undated.map((d) => (
            <div key={d.id}>
              {d.plan_date && <p className="muted small" style={{ margin: "0 0 4px" }}>Planlagt {dayLabel(d.plan_date)}</p>}
              {card(d)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
