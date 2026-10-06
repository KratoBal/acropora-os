import type { ServiceJobStatusValue } from "./service-job-management.js";
import type { WorksheetVersionStatus } from "./worksheet-management.js";

/**
 * A FELADATAIM OLDAL A SZERVIZES SZEMSZÖGÉBŐL (kártya 041a3dd5; Balázs döntése
 * 2026-09-02 11:37, „2.”: állapot szerinti csoportosítás; tervrajz:
 * exchange/picasso-feladataim-2-allapot-*.png).
 *
 * A rád osztott hibajegyek és munkalapok két csoportban: „Rajtad múlik” (most
 * tudsz lépni) és „Máson múlik” (a másik fél lép). A lejárt tétel NEM külön
 * szekció, hanem egy piros sor a saját helyén. Ugyanaz az oldal, szerep
 * szerint más tartalommal: a szervizes ezt kapja, mindenki más a flotta- és a
 * kézi feladatokat.
 *
 * A BESOROLÁS TISZTA FÜGGVÉNY, a napkezdetet a hívó adja (Budapest): így a
 * szabály egy helyen áll, és időzóna nélkül mérhető.
 */

export type MyServiceWorkKind = "SERVICE_JOB" | "WORKSHEET";

/** Rajtad múlik / Máson múlik / lezárt. */
export type MyServiceWorkBucket = "MINE" | "OTHERS" | "CLOSED";

export type MyServiceWorkView = "OPEN" | "CLOSED";

export const MY_SERVICE_WORK_VIEWS: readonly MyServiceWorkView[] = [
  "OPEN",
  "CLOSED",
] as const;

export interface MyServiceWorkItem {
  kind: MyServiceWorkKind;
  id: string;
  /** HJ-2026-0141, M-2026-0871; számozatlan munkalapnál `null`. */
  number: string | null;
  /** Hibajegynél a `ServiceJobStatusValue`, munkalapnál a `WorksheetDisplayStatus`. */
  status: string;
  /** Hibajegynél a cím; munkalapnál `null`. */
  title: string | null;
  /** A partner és a helyszín, ahogy a listák mutatják. */
  partnerName: string | null;
  unitName: string | null;
  /** Hibajegynél a betervezett időpont (ISO); különben `null`. */
  scheduledAt: string | null;
  /**
   * Ha a tétel lejárt, a lejárat napja (ISO): piros sor a saját helyén.
   * Munkalapnál mindig `null` -- feladat-határideje nincs (a változat `dueDate`
   * mezője fizetési határidő).
   */
  overdueSince: string | null;
  /** Munkalapnál: kiment-e távoli aláírásra (akkor a vevő lép). */
  sentForSignature: boolean;
  bucket: MyServiceWorkBucket;
  createdAt: string;
}

export interface MyServiceWorkResponse {
  view: MyServiceWorkView;
  /** „Rajtad múlik”, elöl a lejártakkal. Lezárt nézetben üres. */
  mine: MyServiceWorkItem[];
  /** „Máson múlik”. Lezárt nézetben üres. */
  others: MyServiceWorkItem[];
  /** A lezártak. Nyitott nézetben üres. */
  closed: MyServiceWorkItem[];
  /** A nyitott tételek száma (a „N nyitott” felirathoz), nézettől függetlenül. */
  openCount: number;
}

const JOB_CLOSED: readonly ServiceJobStatusValue[] = ["COMPLETED", "CANCELLED"];
const JOB_WAITING_ON_OTHERS: readonly ServiceJobStatusValue[] = [
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
];

/**
 * A HIBAJEGY CSOPORTJA. A Betervezve az időpontján múlik: ha ma vagy már
 * elmúlt, rajtad (menni kell); ha jövőbeli, a naptár lép, nem te.
 */
export function serviceJobWorkBucket(input: {
  status: ServiceJobStatusValue;
  scheduledAt: Date | null;
  /** A holnapi nap kezdete (Budapest). */
  tomorrowStart: Date;
}): MyServiceWorkBucket {
  if (JOB_CLOSED.includes(input.status)) return "CLOSED";
  if (JOB_WAITING_ON_OTHERS.includes(input.status)) return "OTHERS";
  if (
    input.status === "SCHEDULED" &&
    input.scheduledAt &&
    input.scheduledAt >= input.tomorrowStart
  )
    return "OTHERS";
  return "MINE";
}

/**
 * A HIBAJEGY LEJÁRATA: a betervezett időpont egy korábbi napra esett, és a
 * jegy még nyitott. A napnál pontosabb nem kell: ma délelőtti időpont még nem
 * „lejárt”.
 */
export function serviceJobOverdueSince(input: {
  status: ServiceJobStatusValue;
  scheduledAt: Date | null;
  /** A mai nap kezdete (Budapest). */
  todayStart: Date;
}): Date | null {
  if (JOB_CLOSED.includes(input.status) || !input.scheduledAt) return null;
  return input.scheduledAt < input.todayStart ? input.scheduledAt : null;
}

/**
 * A MUNKALAP CSOPORTJA a legutolsó változat szerint. Az aláírásra váró lap
 * rajtad múlik, amíg helyben kell aláíratni; ha kiment távoli aláírásra, a
 * vevő lép.
 */
export function worksheetWorkBucket(input: {
  status: WorksheetVersionStatus;
  sentForSignature: boolean;
}): MyServiceWorkBucket {
  switch (input.status) {
    case "SIGNED":
      return "CLOSED";
    case "AWAITING_SIGNATURE":
      return input.sentForSignature ? "OTHERS" : "MINE";
    case "DRAFT":
    case "REJECTED":
      return "MINE";
  }
}

/**
 * A SORREND egy csoporton belül: elöl a lejárt (a legrégebben lejárt első),
 * utána a régebbi tétel. A lezártaknál a legújabb első.
 */
export function sortMyServiceWork(
  items: readonly MyServiceWorkItem[],
  bucket: MyServiceWorkBucket,
): MyServiceWorkItem[] {
  return [...items].sort((a, b) => {
    if (bucket === "CLOSED") return b.createdAt.localeCompare(a.createdAt);
    if (a.overdueSince && !b.overdueSince) return -1;
    if (!a.overdueSince && b.overdueSince) return 1;
    if (a.overdueSince && b.overdueSince) {
      const byOverdue = a.overdueSince.localeCompare(b.overdueSince);
      if (byOverdue) return byOverdue;
    }
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
