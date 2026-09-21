import { type ServiceJobStatus } from "@acropora/database";
import {
  ALL_SERVICE_JOB_STATUS_VALUES,
  PARTNER_STATUS_LABELS as KOZOS_PARTNER_STATUS_LABELS,
  partnerStatusLabel as kozosPartnerStatusLabel,
  partnerVisibleStatus as kozosPartnerVisibleStatus,
  type ServiceJobPartnerStatus,
  type ServiceJobStatusValue,
} from "@acropora/types";

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
 * === A LEKÉPEZÉS 2026-09-21 ÓTA A `@acropora/types`-BAN ÁLL ===
 *
 * EGY HELYEN ÁLL TOVÁBBRA IS, csak máshol. Az ok a partnerportál: a jegy
 * NAPLÓJÁBAN is meg akarja nevezni, melyik állapotba lépett a jegy, és a
 * napló-bejegyzés csak a BELSŐ értéket hordozza. A szerver a lista- és a
 * részletválaszba beteszi a feliratot, a naplósorokba nem -- a portál pedig
 * `apps/api`-ból nem importálhat.
 *
 * AMI ITT MARADT, ÉS MIÉRT: a Prisma típusára szabott BURKOLÓK és a séma
 * tükrének ŐRZŐJE. A közös csomag a kliensé is, tehát nem függhet az
 * adatbázis-klienstől -- a tükör ezért ott KÉZZEL írt, és az összekötése
 * szerveroldali munka.
 *
 * ÉS EGY MEGJEGYZÉS A NYOLC EREDETÉRŐL, mert egyszer már félrevitt minket:
 * a nyolc érték a SÉMÁBAN áll, de a séma nem döntés, hanem egy korábbi döntés
 * LENYOMATA. 2026-09-02-án egy állapotgépet terveztünk rá, és közben kiderült,
 * hogy Balázs 2026-08-26-án NÉGY állapotot nevezett meg. A kettő nem mondott
 * ellent - de ezt nem a séma mondta meg, hanem a döntések helye. Amikor ez a
 * modul bővül, MINDKÉT forrást meg kell nézni.
 */
export type PartnerVisibleStatus = ServiceJobPartnerStatus;

export const PARTNER_STATUS_LABELS = KOZOS_PARTNER_STATUS_LABELS;

/**
 * A NYOLC ALLAPOT, FUTASIDOBEN -- ES NEM KEZZEL IRT LISTAKENT.
 *
 * A felsorolast a kozos csomag allitja elo a lekepezes kulcsaibol, tehat egy
 * kilencedik allapot felvetelekor magatol bovul. Itt csak a SEMA tipusara
 * fordul at -- amit a lap aljan allo ket orzo kot ossze a tukorrel.
 *
 * (A Prisma enum futasidoben nem all rendelkezesre: a `@acropora/database`
 * csak TIPUSKENT exportalja, tehat `Object.values(ServiceJobStatus)` nem
 * fordul le.)
 */
export const ALL_SERVICE_JOB_STATUSES =
  ALL_SERVICE_JOB_STATUS_VALUES as ServiceJobStatus[];

/**
 * A KET BURKOLO A SEMA TIPUSAT VESZI, ES EZ NEM FOLOSLEGES REPETES.
 *
 * A hivoknal `ServiceJobStatus` (Prisma) all, a kozos fuggveny pedig a TUKROT
 * varja. A ketto ma ugyanaz az unio -- es pont ezt bizonyitja a lap aljan allo
 * ket orzo. Ha egyszer elcsusznak, ITT hasal el a forditas, nevvel, nem a
 * hivok szaz helyen.
 */
export function partnerVisibleStatus(
  status: ServiceJobStatus,
): PartnerVisibleStatus {
  return kozosPartnerVisibleStatus(status);
}

export function partnerStatusLabel(status: ServiceJobStatus): string {
  return kozosPartnerStatusLabel(status);
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
 *
 * ÉS 2026-09-21 ÓTA TÖBBET IS TART: a fenti két burkoló a séma típusát adja át
 * egy tükör-típusú függvénynek, tehát az itteni egyezés nem kényelmi kérdés,
 * hanem az, ami miatt a két hívás egyáltalán lefordul.
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
