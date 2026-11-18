/**
 * A JEGY FAJTÁJA A PARTNER PORTÁLON (Luca, 2026-11-18 14:50 UTC; acrobot 55980; Balázs 11:31: a karbantartásnak semmi köze a hibajegyekhez): a karbantartási lap (`MAINTENANCE`) KÜLÖN
 * menüpont (`/karbantartas`), saját listával és adatlappal, saját szavakkal; a hibajegy (`REPAIR`) útvonala és szövege marad. Egy hely, ahonnan a lista, az adatlap, a menü és a munkalap-link
 * ugyanazt az útvonalat és szót veszi, hogy ne csússzanak szét.
 */
export type TicketKind = "REPAIR" | "MAINTENANCE";

export const ticketRoute = (kind: TicketKind): "hibajegyek" | "karbantartas" =>
  kind === "MAINTENANCE" ? "karbantartas" : "hibajegyek";

export const ticketHref = (kind: TicketKind, id: string): string =>
  `/${ticketRoute(kind)}/${id}`;

export const TICKET_WORDING = {
  REPAIR: {
    listTitle: "Hibajegyek",
    listLead:
      "Tekintse át a saját cége hibajegyeit és azok aktuális állapotát.",
    column: "Hibajegy",
    listLoadError: "A hibajegyek nem tölthetők be.",
    listLoading: "Hibajegyek betöltése…",
    emptyTitle: "Nincs megjeleníthető hibajegy",
    emptyText: "Ebben az állapotszűrőben jelenleg nincs saját hibajegye.",
    totalSuffix: "hibajegy összesen",
    back: "Hibajegyek",
    detailLoadError: "A hibajegy nem tölthető be.",
    detailLoading: "Hibajegy betöltése…",
    problemTitle: "Mi a probléma?",
    noDescription: "A hibajegyhez nem rögzítettek részletes leírást.",
    historyTitle: "Mi történt a hibajeggyel?",
    noEvent: "A hibajegyhez még nem rögzítettek további eseményt.",
    worksheetsTitle: "Munkalapok a jegy mögött",
    caseDataTitle: "Az ügy adatai",
    createdLabel: "Bejelentés ideje",
    stateLabel: "Az ügy állapota",
  },
  MAINTENANCE: {
    listTitle: "Karbantartás",
    listLead:
      "Tekintse át a saját cége karbantartási lapjait és azok állapotát.",
    column: "Karbantartási lap",
    listLoadError: "A karbantartási lapok nem tölthetők be.",
    listLoading: "Karbantartási lapok betöltése…",
    emptyTitle: "Nincs megjeleníthető karbantartási lap",
    emptyText:
      "Ebben az állapotszűrőben jelenleg nincs saját karbantartási lapja.",
    totalSuffix: "karbantartási lap összesen",
    back: "Karbantartás",
    detailLoadError: "A karbantartási lap nem tölthető be.",
    detailLoading: "Karbantartási lap betöltése…",
    problemTitle: "Leírás",
    noDescription: "A karbantartási laphoz nem rögzítettek leírást.",
    historyTitle: "Mi történt a karbantartási lappal?",
    noEvent: "A karbantartási laphoz még nem rögzítettek további eseményt.",
    worksheetsTitle: "Munkalapok",
    caseDataTitle: "A lap adatai",
    createdLabel: "Létrehozva",
    stateLabel: "A karbantartás állapota",
  },
} as const satisfies Record<TicketKind, Record<string, string>>;
