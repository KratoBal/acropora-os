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
    kind: "REPAIR" as const,
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
    /**
     * A HELYSZIN MOSTANTOL VALOS ERTEK, NEM `null` -- ES EZ A SOR ATIRODOTT,
     * NEM CSAK A KOMMENT.
     *
     * Eddig itt `null` allt, azzal az indokkal, hogy a mezo 2026-09-14-en
     * keletkezett, tehat a legtobb korabbi jegyen ures. Balazs dontese ("1
     * legyen kotelezo") szerint a `ServiceJob.departmentId`-nak KOTELEZONEK
     * KELL LENNIE, de ez MA MEG csak alkalmazas-szinten igaz: a sema-szintu
     * NOT NULL (`20260924101500_department_required` migracio) KULON, DRAFT
     * PR-ben van (acrobot kerese, 2026-09-24 10:25), csak a mobil kiadas
     * utan olvasztjuk be. A `null` tehat MA MEG FIZIKAILAG ELOALLHATNA a
     * sema szerint -- ez a fixture-sor csak azert visel valos erteket, mert
     * a MEGCELZOTT vegallapotot tukrozi, nem mert a mai tipus kikenyszeritene.
     *
     * EGYETLEN HIVO SEM MERTE EXPLICITEN a helyszin ERTEKET vagy HIANYAT (lasd
     * `service-jobs.detail.spec.ts`, `service-jobs.move.spec.ts`): mindegyik
     * ezt az alapertelmezest OROKOLTE MELLESLEG. A valtoztatas tehat egyetlen
     * tesztelt viselkedest sem mozdit.
     */
    departmentId: "unit-1",
    department: { name: "Biodóm", code: "BIO", parent: null },
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
     * A HELYSZIN UTJA ALAPBAN `null` MARAD, DE MAR NEM A "GYAKORI ESET" -- A
     * DEPARTMENTID KOTELEZOVE VALASA (fent) OTA CSAK EGY IGNORALT MEZO.
     *
     * A `departmentPath`-ot az `unitPathFor` szamolja a `departmentId`-bol
     * kulon lekerdezessel (lasd `service-jobs.repository.ts`), es ezt a
     * fixture nem hivja meg -- ide csak azert kerul, mert a tipus
     * (`ServiceJobDetailRow`) elvarja a mezot. Egyetlen itt allo teszt sem
     * meri az UTAT: ami az utat meri, az a sajat esetenel allitja be
     * `overrides`-szal.
     */
    departmentPath: null,
    ...overrides,
  } satisfies NonNullable<ServiceJobDetailRow>;
}
