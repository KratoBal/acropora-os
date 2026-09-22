import type { ServiceJobStatus } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { isFinishedServiceJobStatus } from "./service-job-list-scope.js";

/**
 * MEDDIG SZERKESZTHETO A HIBAJEGY LEIRASA.
 *
 * Balazs ket KULON hatart mondott ki, 2026-09-22:
 *
 *   belsos hivo    a jegy LEZARASAIG        (11:04:01 UTC, "3")
 *   partner hivo   amig NINCS munkalapja    (10:40:49 es 10:43:05 UTC)
 *
 * === MIERT SAJAT FUGGVENY, ES MIERT NEM A `requireWriteScope` ===
 *
 * A kezenfekvo valasztas a `requireWriteScope` lenne: ott all az ot iro ut elso
 * soraban, es a fejlece joggal dicseri, hogy EGY helyen dont. Csak epp MAS
 * kerdesre valaszol: azt mondja meg, SZABAD-E EGYALTALAN irni ezen az uton.
 *
 * ITT a hatokor nem KIZAR, hanem MEGVALASZTJA a hatart. Ha a
 * `requireWriteScope` allna a metodus elso soraban, a partner 404-et kapna,
 * MIELOTT ez a fuggveny szohoz jutna -- vagyis a partner-ag meg sem szuletne,
 * es csendben kiesne pont az, amit Balazs kert.
 *
 * ES EZ A KALIBRACIOBAN IS LATSZIK: a ket agat felcserelo ket rontasnak KULON
 * allitasokat kell pirosra vinnie. Ha a `requireWriteScope` elvagja a partnert,
 * mind a ketto UGYANARRA fut, es a meres onmagaban nezve helyesnek latszik.
 *
 * === A "LEZARVA" A MEGLEVO KONSTANSBOL JON ===
 *
 * `service-job-list-scope.ts`, es NEM egy uj lista: ott KET ertek all
 * (`COMPLETED` es `CANCELLED`). Egy masodik felsorolas eloбb-utobb elcsuszna, es
 * a kulonbseg nema lenne.
 *
 * === AZ OKOT IS VISSZAADJA, NEM CSAK IGENT-NEMET ===
 *
 * A negy ertek NEVE a hibauzenetbe kerul. Ma harom kulonbozo helyen lattunk
 * olyan hibat, ahol a felhasznalo "nem talalhato"-t kapott, holott a valodi ok
 * hatar volt -- es a kulonbseget csak a kodbol lehetett kiolvasni.
 */
export type DescriptionEditBlocker =
  "FINISHED" | "HAS_WORKSHEET" | "OUT_OF_SCOPE";

export interface DescriptionEditSubject {
  readonly status: ServiceJobStatus;
  /**
   * VAN-E A JEGYEN MUNKALAP. A hivo szamolja ki, egy lekerdezessel.
   *
   * SZANDEKOSAN LOGIKAI ERTEK ES NEM DARABSZAM: a hatar nem attol fugg, hany lap
   * all rajta. Egy darabszam itt csak azt a latszatot keltene, hogy a fuggveny
   * tobbet tud, mint amennyit eldont.
   */
  readonly hasWorksheet: boolean;
}

export function descriptionEditBlocker(
  scope: PartnerScope,
  job: DescriptionEditSubject,
): DescriptionEditBlocker | null {
  if (scope.kind === "internal")
    return isFinishedServiceJobStatus(job.status) ? "FINISHED" : null;

  /**
   * A SZALLITO NEM SZERKESZT VEVOI BEJELENTEST. Nem a jegy allapotan mulik,
   * tehat nem a masik ket ertek valamelyike: a hatokor maga zarja ki.
   */
  if (scope.kind !== "customer") return "OUT_OF_SCOPE";

  return job.hasWorksheet ? "HAS_WORKSHEET" : null;
}

/** A felhasznalonak szolo mondat, fajtankent. */
export const DESCRIPTION_EDIT_BLOCKER_MESSAGES: Record<
  DescriptionEditBlocker,
  string
> = {
  FINISHED: "A hibajegy le van zárva, ezért a leírása már nem módosítható.",
  HAS_WORKSHEET:
    "A hibajegyhez már tartozik munkalap, ezért a leírása már nem módosítható.",
  OUT_OF_SCOPE: "A hibajegy leírását nem módosíthatod.",
};
