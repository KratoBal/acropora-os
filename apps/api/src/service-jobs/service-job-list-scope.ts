import type { Prisma, ServiceJobStatus } from "@acropora/database";
import { SERVICE_JOB_FINISHED_STATUSES } from "@acropora/types";

/**
 * A LEZART ALLAPOTOK -- A KOZOS CSOMAGBOL, NEM ITT.
 *
 * 2026-09-22-ig ez a fajl tartotta a listat, privatkent. Akkor kellett a
 * FELULETNEK is (a leiras-szerkeszto megjeleniteséhez), es egy masodik masolat
 * pontosan az a nema elcsuszas lett volna, amit az eredeti jegyzet megnevez.
 * A lista a `packages/types`-ban all, es minden olvaso onnan veszi -- ez a
 * fajl is.
 */
// A MASOLAT ITT A PRISMA MIATT VAN, NEM A SZABALY MIATT: a `where` zaradek
// MUTABLE tombot var, a kozos lista viszont `readonly` (szandekosan -- egy
// exportalt tomb, amit barki atirhat, nem konstans). A SZABALY tehat tovabbra
// is EGY helyen all; ez a sor csak a tipus alakjat igazitja.
const FINISHED = [...SERVICE_JOB_FINISHED_STATUSES] as ServiceJobStatus[];

/**
 * LEZART-E EGY JEGY -- UGYANABBOL A LISTABOL, NEM EGY MASODIKBOL.
 *
 * A leiras-szerkesztes belsos hatara ugyanaz a fogalom, mint a lista `closed`
 * hatokore, es ezert NEM ir uj felsorolast: ket lista ugyanarra a fogalomra
 * pontosan azt a nema elcsuszast szulne, amit a fenti jegyzet megnevez.
 *
 * KET ERTEKU, ES EZ A TESZTBEN IS SZAMIT: egy csak `COMPLETED`-re irt allitas
 * zold maradna, ha valaki a `CANCELLED`-et kihagyja.
 */
export function isFinishedServiceJobStatus(status: ServiceJobStatus): boolean {
  return FINISHED.includes(status);
}

/**
 * A LISTA NEGY HATOKORE.
 *
 * Balazs kerese (2026-09-17, Discord): "en szurni szeretnem: osszes, nyitott,
 * lezart, ram kiosztva es az osszes legyen az alapertelmezett".
 *
 * A SZURES A SZERVEREN TORTENIK, NEM A KLIENSEN, es ez nem izles: a lista
 * kettoszaz sornal vagodik, es a valasz `truncated` mezoje errol a VAGOTT
 * halmazrol szol. Egy kliens-oldali szuro tehat csendben kevesebbet mutatna,
 * mint amit a felirata iger.
 *
 * AZ ALAPERTELMEZES A SZERVEREN MARAD `open`, es a `osszes` alapertelmezest a
 * TELEFON kuldi ki magabol. Balazs kerese a MOBIL alkalmazasra szolt; a
 * szerveren atallitva a WEBES lista is elmozdulna, amirol senki nem kert
 * semmit -- es az a fajta valtozas nema.
 */
export const SERVICE_JOB_LIST_SCOPES = [
  "open",
  "all",
  "closed",
  "mine",
] as const;

export type ServiceJobListScope = (typeof SERVICE_JOB_LIST_SCOPES)[number];

/**
 * EGY HATOKOR FELTETELE -- TISZTA FUGGVENY, adatbazis nelkul merheto.
 *
 * A VISSZATERES `Prisma.ServiceJobWhereInput`, es a hivo ezt TOVABBI `AND`
 * tagkent teszi a lathatosagi szuro melle. Nem `OR` ag: a hatokor SZUKIT a
 * lathatoon belul, nem nyit meg semmit, amit a nezo amugy nem lathatna.
 *
 * NINCS `default` AG, es ez szandekos: igy egy uj hatokor felvetele a
 * `SERVICE_JOB_LIST_SCOPES` listaba MEGALLITJA a forditot itt. Egy `default`
 * mellett az uj ertek csendben a legtagabb halmazt adna vissza.
 */
export function serviceJobScopeWhere(
  scope: ServiceJobListScope,
  viewerUserId: string,
): Prisma.ServiceJobWhereInput {
  switch (scope) {
    case "open":
      return { status: { notIn: FINISHED } };
    case "closed":
      return { status: { in: FINISHED } };
    /**
     * A KIOSZTAS A `ServiceJobAssignee` TABLAN ALL, NEM A JEGY
     * `assignedUserId` OSZLOPAN.
     *
     * A regi oszlop LETEZIK, de HALOTT: a teljes TypeScript faban nulla iroja
     * es nulla olvasoja van (merve 2026-09-17, pozitiv kontroll ugyanazzal a
     * keresessel: `openedById` 19 talalat). Ra szurve ez a lista MINDIG ures
     * lenne, es semmi nem szolna rola -- egy ures lista pontosan ugy nez ki,
     * mint az, hogy nincs rad kiosztva semmi.
     *
     * A tabla sajat indexe (`[userId, assignedAt]`) epp erre a kerdesre epult;
     * a sema ott ki is mondja: "A szervizes sajat jegyeinek listaja ezen az
     * indexen fut".
     *
     * ES NEM SZUKUL NYITOTTRA. A negy valaszto EGY csoport, tehat a "ram
     * kiosztva" a rajtam levo TELJES halmaz. Aki csak a nyitottakat akarja, a
     * "nyitott" valasztot nyomja meg. Ha a helyszini hasznalat mast mutat, ez
     * egy sor.
     */
    case "mine":
      return { assignees: { some: { userId: viewerUserId } } };
    case "all":
      return {};
  }
}
