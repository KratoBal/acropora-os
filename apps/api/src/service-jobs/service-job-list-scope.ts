import type { Prisma, ServiceJobStatus } from "@acropora/database";

/**
 * A LEZART ALLAPOTOK, EGY HELYEN. Ha egy uj zaro allapot keletkezik, itt kell
 * felvenni -- es ettol a `nyitott` ES a `lezart` hatokor EGYSZERRE mozdul,
 * tehat a ketto nem tud elcsuszni egymastol.
 */
const FINISHED: ServiceJobStatus[] = ["COMPLETED", "CANCELLED"];

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
