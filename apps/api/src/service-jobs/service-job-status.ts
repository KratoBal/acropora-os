import { type ServiceJobStatus } from "@acropora/database";
import type { ServiceJobStatusValue } from "@acropora/types";

/**
 * AMIT A PARTNER LÁT, ÉS AMIT MI BELÜL TARTUNK.
 *
 * NÉGY ÁLLAPOT KIFELÉ, NYOLC BELÜL (Balázs döntése, 2026-09-02: „Legyen a
 * 4/8"). A kettő nem két rendszer: a nyolc a négynek a RÉSZLETEZÉSE.
 *
 * MIÉRT NEM UGYANAZ A LISTA. Hogy egy jegy alkatrészre vár vagy az ügyfélre,
 * az a MI munkaszervezésünk - a partnernek mindkettő egyszerűen „feldolgozás
 * alatt". Ha a nyolcat mutatnánk kifelé, a partner a mi belső akadályainkat
 * olvasná, és minden alkatrész-várakozásról értesülne.
 *
 * A NÉGY NEVE A PARTNER NYELVE, nem a miénk: „Feldolgozás alatt" - ezt Balázs
 * 2026-08-26-án szó szerint így mondta.
 *
 * EGY HELYEN ÁLL, ÉS EZ NEM RENDRAKÁS. Ha a leképezés két helyen volna,
 * egyszer elcsúszna, és onnantól a partner MÁST látna, mint amit mi hiszünk
 * róla - egy ilyen eltérés nem hibázik, csak félretájékoztat.
 *
 * ÉS EGY MEGJEGYZÉS A NYOLC EREDETÉRŐL, mert ma egyszer már félrevitt minket:
 * a nyolc érték a SÉMÁBAN áll, de a séma nem döntés, hanem egy korábbi döntés
 * LENYOMATA. 2026-09-02-án egy állapotgépet terveztünk rá, és közben kiderült,
 * hogy Balázs 2026-08-26-án NÉGY állapotot nevezett meg. A kettő nem mondott
 * ellent - de ezt nem a séma mondta meg, hanem a döntések helye. Amikor ez a
 * modul bővül, MINDKÉT forrást meg kell nézni.
 */
export type PartnerVisibleStatus =
  "NEW" | "IN_PROGRESS" | "COMPLETED" | "CLOSED";

export const PARTNER_STATUS_LABELS: Record<PartnerVisibleStatus, string> = {
  NEW: "Új",
  IN_PROGRESS: "Feldolgozás alatt",
  COMPLETED: "Elkészült",
  CLOSED: "Lezárva",
};

/**
 * A nyolc belső állapot leképezése a négy látszóra.
 *
 * A `CANCELLED` a `CLOSED` alá esik: a partner felé az elállt jegy is lezárt
 * ügy. Hogy MIÉRT zárult le, az a mi oldalunk - és egy külön „elállt" állapot
 * kifelé olyan magyarázatot kérne, amit nem minden esetben akarunk megadni.
 */
const PARTNER_STATUS: Record<ServiceJobStatus, PartnerVisibleStatus> = {
  NEW: "NEW",
  TRIAGED: "IN_PROGRESS",
  SCHEDULED: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_FOR_PARTS: "IN_PROGRESS",
  WAITING_FOR_CUSTOMER: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CLOSED",
};

export function partnerVisibleStatus(
  status: ServiceJobStatus,
): PartnerVisibleStatus {
  return PARTNER_STATUS[status]!;
}

export function partnerStatusLabel(status: ServiceJobStatus): string {
  return PARTNER_STATUS_LABELS[partnerVisibleStatus(status)];
}

/**
 * A TÜKÖR ŐRZŐJE, ÉS EZÉRT ÁLL ITT, NEM A KÖZÖS CSOMAGBAN.
 *
 * A `@acropora/types` a kliensé is, tehát nem függhet a Prisma kliensétől: a
 * nyolc állapot ott KÉZZEL ÍRT tükör. Egy tükör pedig elcsúszik - nem
 * elfelejtésből, hanem mert a séma bővül, és a bővítés pillanatában semmi nem
 * történik.
 *
 * Ez a két sor a szerveroldalon köti össze a kettőt, MINDKÉT IRÁNYBAN: az első
 * akkor hasal el, ha a sémába kerül új állapot, ami a tükörben nincs; a
 * második akkor, ha a tükörben van olyan, ami a sémából eltűnt. Futásidőben
 * nem csinál semmit; a fordító veszi észre, és nem a felhasználó.
 */
const _SCHEMA_COVERS_MIRROR: Record<ServiceJobStatus, ServiceJobStatusValue> = {
  NEW: "NEW",
  TRIAGED: "TRIAGED",
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_FOR_PARTS: "WAITING_FOR_PARTS",
  WAITING_FOR_CUSTOMER: "WAITING_FOR_CUSTOMER",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const _MIRROR_COVERS_SCHEMA: Record<ServiceJobStatusValue, ServiceJobStatus> =
  _SCHEMA_COVERS_MIRROR;

void _MIRROR_COVERS_SCHEMA;
