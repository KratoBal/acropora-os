/**
 * A PARTNER ÁTTEKINTÉSE: "TEENDŐIM" (kártya 28f31715; Balázs, 2026-11-25 13:07 UTC, OS szál: „a partner portalon jo lenne egy
 * dashboard jellegu valami ... latna az ugyfel, hogy van e uj hibajegy, munkalap, illetve kell e alairnia vagy foglalkoznia
 * valamivel"). Ami MOST a partnerre vár, darabszámmal és közvetlen linkkel.
 *
 * TISZTA FÜGGVÉNYEK, HITELESÍTÉSTŐL FÜGGETLENÜL (Balázs publikus-alap szabálya, 2026-09-25): a besorolás a már láthatóra szűrt
 * listák soraiból dolgozik; hogy ki mit lát, azt a hívó dönti el (a szerver a partner saját lista-útjaival), ez a modul nem.
 *
 * A TEENDŐK:
 *   - munkalap aláírásra vár: AWAITING_SIGNATURE, és ki is küldték aláírásra (a partner adatlapja ugyanígy kapuz);
 *   - teljesítési igazolás aláírt példányra vár: még nincs aláírt példánya, és a felhasználó feltölthet;
 *   - karbantartási megrendelőlap aláírt példányra vár: kiállított (ISSUED), és a felhasználó feltölthet;
 *   - hibajegy a partner válaszára vár: belső állapota WAITING_FOR_CUSTOMER. A JEGY FELIRATA NEM VÁLTOZIK (acrobot 61350, Balázs
 *     2026-09-02-i "4/8" döntése marad: kifelé négy állapot, a listán "Feldolgozás alatt"); a "Válaszra vár" CSAK itt, a Teendőim
 *     között áll, mert Balázs mostani kérése épp ezt kéri: „kell e ... foglalkoznia valamivel".
 */
export type PartnerTodoKind =
  | "TICKET_REPLY"
  | "WORKSHEET_SIGNATURE"
  | "CERTIFICATE_SIGNED_COPY"
  | "MAINTENANCE_ORDER_SIGNED_COPY";

export interface PartnerTodoItem {
  id: string;
  /** A sor felirata a listán (szám és tárgy, ahogy a partner ismeri). */
  title: string;
  /** A portál útvonala, ahol a teendő elvégezhető. */
  href: string;
}

export interface PartnerTodoGroup {
  kind: PartnerTodoKind;
  label: string;
  count: number;
  /** A legfeljebb `PARTNER_TODO_ITEMS` legfrissebb tétel; a többi a lista-oldalon. */
  items: PartnerTodoItem[];
  /** A teljes lista útvonala. */
  listHref: string;
}

export interface PartnerOverview {
  /** Csak a nem üres csoportok, a fenti sorrendben; üres tömb: nincs teendő. */
  todos: PartnerTodoGroup[];
  /** Az "Újdonságok" (PR 2): csak a nem üres csoportok; hiányzik a régi válaszból. */
  news?: PartnerNewsGroup[];
}

/**
 * "ÚJDONSÁGOK" (kártya 28f31715, PR 2): ami a partner LEGUTÓBBI LÁTOGATÁSA ÓTA keletkezett a két figyelt listán. A látogatás a lista
 * megnyitása (`PartnerSeen`); aki még sosem nyitotta meg, annak az utolsó `PARTNER_NEWS_FIRST_VISIT_DAYS` nap új.
 */
export type PartnerSeenArea = "TICKETS" | "WORKSHEETS";

export interface PartnerNewsGroup {
  area: PartnerSeenArea;
  label: string;
  count: number;
  items: PartnerTodoItem[];
  listHref: string;
  /** Mióta számít újnak (ISO): a legutóbbi látogatás, vagy az első látogatás előtti hét. */
  since: string;
}

export const PARTNER_NEWS_FIRST_VISIT_DAYS = 7;

export const PARTNER_NEWS_LABELS: Record<PartnerSeenArea, string> = {
  TICKETS: "Új hibajegy",
  WORKSHEETS: "Új munkalap",
};

/** Mióta új egy terület: a legutóbbi látogatás, vagy a nélkül az utolsó hét. */
export function partnerNewsSince(
  lastSeenAt: string | null | undefined,
  now: Date,
): string {
  return (
    lastSeenAt ??
    new Date(
      now.getTime() - PARTNER_NEWS_FIRST_VISIT_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
  );
}

/** Az "Újdonságok": a sorok közül, amelyek a terület `since` időpontja UTÁN keletkeztek; a legfrissebb elöl, legfeljebb öt. */
export function partnerNewsOf(input: {
  tickets: readonly {
    id: string;
    jobNumber: string;
    title: string;
    createdAt: string;
    kind?: "REPAIR" | "MAINTENANCE";
  }[];
  worksheets: readonly {
    id: string;
    number: string | null;
    subject: string;
    createdAt: string;
  }[];
  since: Record<PartnerSeenArea, string>;
}): PartnerNewsGroup[] {
  const newer = <T extends { createdAt: string }>(
    rows: readonly T[],
    since: string,
  ) =>
    rows
      .filter((row) => Date.parse(row.createdAt) > Date.parse(since))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const tickets = newer(input.tickets, input.since.TICKETS).map((row) => ({
    id: row.id,
    title: [row.jobNumber, row.title.trim()].filter(Boolean).join(" · "),
    href: `${row.kind === "MAINTENANCE" ? "/karbantartas" : "/hibajegyek"}/${enc(row.id)}`,
  }));
  const worksheets = newer(input.worksheets, input.since.WORKSHEETS).map(
    (row) => ({
      id: row.id,
      title: [row.number, row.subject.trim()].filter(Boolean).join(" · "),
      href: `/munkalapok/${enc(row.id)}`,
    }),
  );
  const groups: PartnerNewsGroup[] = [
    {
      area: "TICKETS",
      label: PARTNER_NEWS_LABELS.TICKETS,
      count: tickets.length,
      items: tickets.slice(0, PARTNER_TODO_ITEMS),
      listHref: "/hibajegyek",
      since: input.since.TICKETS,
    },
    {
      area: "WORKSHEETS",
      label: PARTNER_NEWS_LABELS.WORKSHEETS,
      count: worksheets.length,
      items: worksheets.slice(0, PARTNER_TODO_ITEMS),
      listHref: "/munkalapok",
      since: input.since.WORKSHEETS,
    },
  ];
  return groups.filter((g) => g.count > 0);
}

export const PARTNER_TODO_ITEMS = 5;

export const PARTNER_TODO_LABELS: Record<PartnerTodoKind, string> = {
  TICKET_REPLY: "Válaszra váró hibajegy",
  WORKSHEET_SIGNATURE: "Aláírásra váró munkalap",
  CERTIFICATE_SIGNED_COPY: "Aláírt példányra váró teljesítési igazolás",
  MAINTENANCE_ORDER_SIGNED_COPY: "Aláírt példányra váró megrendelőlap",
};

/** A hibajegy a partner válaszára vár (a belső állapot; a partner felé a felirat "Feldolgozás alatt" marad). */
export const ticketAwaitsPartnerReply = (row: { status: string }) =>
  row.status === "WAITING_FOR_CUSTOMER";

/** A munkalap a partnerre vár: aláírásra vár, és ki is küldték (a dátum kapuz, nem a címzett: lásd a partner adatlapját). */
export const worksheetAwaitsPartnerSignature = (row: {
  status: string;
  sentForSignature?: boolean;
}) => row.status === "AWAITING_SIGNATURE" && row.sentForSignature === true;

/** A teljesítési igazolás aláírt példányra vár, és a felhasználó feltöltheti. */
export const certificateAwaitsSignedCopy = (
  row: { hasSignedDocument: boolean },
  canUploadSigned: boolean,
) => canUploadSigned && !row.hasSignedDocument;

/** A megrendelőlap aláírt példányra vár (kiállított), és a felhasználó feltöltheti. */
export const maintenanceOrderAwaitsSignedCopy = (
  row: { status: string },
  canUploadSigned: boolean,
) => canUploadSigned && row.status === "ISSUED";

const group = (
  kind: PartnerTodoKind,
  listHref: string,
  items: PartnerTodoItem[],
): PartnerTodoGroup => ({
  kind,
  label: PARTNER_TODO_LABELS[kind],
  count: items.length,
  items: items.slice(0, PARTNER_TODO_ITEMS),
  listHref,
});

const enc = encodeURIComponent;

/**
 * A "TEENDŐIM" A LÁTHATÓ SOROKBÓL. A sorok a lista-oldalak sorrendjében jönnek (a legfrissebb elöl); a csoport a darabszámot és
 * az első `PARTNER_TODO_ITEMS` tételt adja, közvetlen linkkel.
 */
export function partnerTodosOf(input: {
  tickets?: readonly {
    id: string;
    jobNumber: string;
    title: string;
    status: string;
    kind?: "REPAIR" | "MAINTENANCE";
  }[];
  /**
   * The waiting tickets' full count, when the ticket list is capped (the server's per-status count); without it the rows are
   * counted.
   */
  waitingTicketCount?: number;
  worksheets: readonly {
    id: string;
    number: string | null;
    subject: string;
    status: string;
    sentForSignature?: boolean;
  }[];
  certificates: readonly {
    id: string;
    number: string;
    hasSignedDocument: boolean;
  }[];
  maintenanceOrders: readonly {
    id: string;
    number: string;
    contractTitle: string;
    status: string;
  }[];
  canUploadSignedCertificate: boolean;
  canUploadSignedMaintenanceOrder: boolean;
}): PartnerOverview {
  const waiting = (input.tickets ?? [])
    .filter(ticketAwaitsPartnerReply)
    .map((row) => ({
      id: row.id,
      title: [row.jobNumber, row.title.trim()].filter(Boolean).join(" · "),
      href: `${row.kind === "MAINTENANCE" ? "/karbantartas" : "/hibajegyek"}/${enc(row.id)}`,
    }));
  const tickets = group("TICKET_REPLY", "/hibajegyek", waiting);
  const groups = [
    {
      ...tickets,
      count: Math.max(input.waitingTicketCount ?? 0, waiting.length),
    },
    group(
      "WORKSHEET_SIGNATURE",
      "/munkalapok",
      input.worksheets.filter(worksheetAwaitsPartnerSignature).map((row) => ({
        id: row.id,
        title: [row.number, row.subject.trim()].filter(Boolean).join(" · "),
        href: `/munkalapok/${enc(row.id)}`,
      })),
    ),
    group(
      "CERTIFICATE_SIGNED_COPY",
      "/teljesitesi-igazolasok",
      input.certificates
        .filter((row) =>
          certificateAwaitsSignedCopy(row, input.canUploadSignedCertificate),
        )
        .map((row) => ({
          id: row.id,
          title: row.number,
          href: `/teljesitesi-igazolasok/${enc(row.id)}`,
        })),
    ),
    group(
      "MAINTENANCE_ORDER_SIGNED_COPY",
      "/megrendelesek",
      input.maintenanceOrders
        .filter((row) =>
          maintenanceOrderAwaitsSignedCopy(
            row,
            input.canUploadSignedMaintenanceOrder,
          ),
        )
        .map((row) => ({
          id: row.id,
          title: [row.number, row.contractTitle.trim()]
            .filter(Boolean)
            .join(" · "),
          href: `/megrendelesek/${enc(row.id)}`,
        })),
    ),
  ];
  return { todos: groups.filter((g) => g.count > 0) };
}
