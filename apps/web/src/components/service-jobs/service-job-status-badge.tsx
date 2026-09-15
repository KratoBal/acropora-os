import type { ServiceJobStatusValue } from "@acropora/types";

import { serviceJobStatusLabel } from "./service-job-labels";

/**
 * AZ ÁLLAPOT JELVÉNYE, A TERV SZÍNEIVEL.
 *
 * SAJÁT JELVÉNY, NEM A KÖZÖS `Badge`. Két oka van, és egyik sem ízlés:
 *
 * A közös `Badge` a nyolc állapotot HÁROM hangra vonja össze
 * (`serviceJobStatusVariant`), a terv ÖTRE - és az öt többet mond: az
 * alkatrészre váró jegy nem ugyanaz, mint az ütemezett. A bővítése minden
 * oldalra kihatna, ez a kör viszont a hibajegy-oldalakra szól. A másik ok a
 * PONT a szöveg előtt: a terv ezzel különbözteti meg az állapotot a többi kis
 * címkétől (partner, munkalap), amikből egy soron belül több is áll.
 *
 * A CSOPORTOSÍTÁS A PROTOTÍPUSBÓL VAN ÁTVÉVE, nem újra kitalálva (app.js,
 * `statuses`): a terv ugyanazt a nyolc nevet használja, amit a sémánk, tehát
 * kész besorolás. Öt hang, nem nyolc - a két váró állapot egy hang, a két
 * végállapot kettő.
 *
 * A SZÍNEK VISZONT A MAIAK, NEM A TERVÉI. A terv a folyamatban lévő családot a
 * márkaszínnel emeli ki, és a márkaszín az arculat-ágon dől el (`#6150bd`).
 * Ha ide beírnám a hozzá legközelebbi Tailwind-lilát, az MÁS lila lenne, és a
 * hibajegy-sorok ütnének el minden más oldaltól anélkül, hogy bármi hibázna.
 * Ezért az a család a mai hangsúlyt viseli; az arculat-ág után magától a
 * márkaszínt fogja.
 */
const TONE: Record<ServiceJobStatusValue, string> = {
  NEW: "bg-sky-50 text-sky-700 ring-sky-200/70",
  TRIAGED: "bg-teal-50 text-teal-700 ring-teal-200/70",
  SCHEDULED: "bg-teal-50 text-teal-700 ring-teal-200/70",
  IN_PROGRESS: "bg-teal-50 text-teal-700 ring-teal-200/70",
  WAITING_FOR_PARTS: "bg-amber-50 text-amber-700 ring-amber-200/70",
  WAITING_FOR_CUSTOMER: "bg-amber-50 text-amber-700 ring-amber-200/70",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function ServiceJobStatusBadge({
  status,
}: {
  status: ServiceJobStatusValue;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[status]}`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-current opacity-70"
      />
      {serviceJobStatusLabel[status]}
    </span>
  );
}
