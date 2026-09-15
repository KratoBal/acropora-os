import type { ServiceJobStatusValue } from "@acropora/types";

import { serviceJobStatusLabel } from "./service-job-labels";

/**
 * AZ ÁLLAPOT JELVÉNYE, A TERV SZÍNEIVEL.
 *
 * SAJÁT JELVÉNY, NEM A KÖZÖS `Badge`. Két oka van, és egyik sem ízlés:
 *
 * A terv a nyolc állapotot ÖT hangra képezi le, köztük egy lilára, ami a közös
 * jelvényben nincs - és a közös `Badge` bővítése minden oldalra kihatna, ez a
 * kör viszont a hibajegy-oldalakra szól. A másik a PONT a szöveg előtt: a terv
 * ezzel különbözteti meg az állapotot a többi kis címkétől (partner, munkalap),
 * amikből egy soron belül több is áll.
 *
 * A LEKÉPEZÉS A PROTOTÍPUSBÓL VAN ÁTVÉVE, nem újra kitalálva (app.js,
 * `statuses`): a terv ugyanazt a nyolc nevet használja, amit a sémánk, tehát
 * kész fordítási tábla. Két helyen kitalálva a két szín egyszer elcsúszna, és
 * a különbség némán utazna a felületre.
 */
const TONE: Record<ServiceJobStatusValue, string> = {
  NEW: "bg-sky-50 text-sky-700 ring-sky-200/70",
  TRIAGED: "bg-violet-50 text-violet-700 ring-violet-200/70",
  SCHEDULED: "bg-violet-50 text-violet-700 ring-violet-200/70",
  IN_PROGRESS: "bg-violet-50 text-violet-700 ring-violet-200/70",
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
