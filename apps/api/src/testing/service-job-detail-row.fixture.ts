import type { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";

/**
 * A HIBAJEGY RESZLETLAPJANAK TAROLO-SORA, EGY HELYEN.
 *
 * KET SPEC HASZNALJA (`service-jobs.detail.spec.ts` es
 * `service-jobs.move.spec.ts`), es korabban KET MASOLAT allt belole. Egy
 * masolat nem uj kockazatot hoz, hanem MEGSOKSZOROZZA a meglevot: ha a
 * tarolo visszateresehez uj relacio kerul, az egyik masolat kovetheti, a
 * masik meg evekig allhat -- es a fordito csak azt a kettot latja, hogy
 * mindketto ONMAGABAN helyes.
 *
 * A TIPUS A VALODI SZERZODESBOL JON (`satisfies`), nem kezzel irt alakbol:
 * igy egy uj kotelezo mezo ITT pirosodik ki, nem a kepernyon.
 */
export type ServiceJobDetailRow = Awaited<
  ReturnType<ServiceJobsRepository["detail"]>
>;

export function serviceJobDetailRow(
  overrides: Partial<NonNullable<ServiceJobDetailRow>> = {},
) {
  return {
    id: "job-1",
    jobNumber: "HJ-2026-001",
    title: "Szivattyú leállt",
    description: null,
    status: "TRIAGED" as const,
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    scheduledAt: null,
    hiddenAt: null,
    startedAt: null,
    completedAt: new Date("2026-09-04T08:00:00.000Z"),
    customerId: "cust-1",
    customer: { displayName: "Fővárosi Állat- És Növénykert" },
    // A HELYSZIN ALAPBOL NINCS a fixture-on: a mezo 2026-09-14-en keletkezett,
    // tehat minden korabbi jegyen `null`. Az az ALAPESET, nem a kivetel -- aki
    // a helyszines agat meri, az `overrides`-szal allitja be.
    departmentId: null,
    department: null,
    events: [
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "NEW" as const,
        note: null,
        createdAt: new Date("2026-09-01T08:00:00.000Z"),
        actor: { displayName: "Szerelő Sándor" },
      },
    ],
    worksheets: [
      {
        id: "worksheet-1",
        number: null,
        createdAt: new Date("2026-09-02T08:00:00.000Z"),
        handedOverAt: null,
        // A NEV A LEGFRISSEBB VERZION LAKIK, ezert all itt tombkent: a
        // lekerdezes `take: 1`-gyel a legmagasabb verziot huzza le.
        versions: [{ subject: "Szivattyú csere" }],
      },
    ],
    assets: [
      {
        id: "link-1",
        assetId: "asset-1",
        createdAt: new Date("2026-09-02T09:00:00.000Z"),
        asset: { assetNumber: "ESZ-0007", name: "Szivattyú" },
      },
    ],
    // ALAPBAN URES, es ezt a delegalas sajat specje tolti fel
    // (`service-job-assignees.spec.ts`). Itt a jelenlete annyit allit, hogy egy
    // delegalatlan jegy reszletlapja TELJES valaszt ad -- nem `undefined`-et.
    assignees: [],
    /**
     * A HELYSZIN UTJA ALAPBAN `null`, es ez nem kitolto ertek: a mai jegyek
     * TOBBSEGENEK nincs helyszine (a mezo 2026-09-14-en keletkezett), tehat ez
     * a gyakori eset. Ami az utat MERI, az a sajat esetenel allitja be.
     */
    departmentPath: null,
    ...overrides,
  } satisfies NonNullable<ServiceJobDetailRow>;
}
