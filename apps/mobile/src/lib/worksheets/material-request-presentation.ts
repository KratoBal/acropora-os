/**
 * ANYAGIGENYLES A MUNKALAPROL -- A TELEFONON HOZOTT DONTESEK.
 *
 * Balazs kerese, 2026-09-22 12:15:46 UTC: a szervizes munka kozben veszi
 * eszre, hogy kell valami, felviszi a teteleket (nev, mennyiseg, egyseg --
 * mindharom szabad szoveg, szandekosan validalatlan), kulon "elkuld" gombbal
 * kuldi el. Ugyanaz a minta, mint a munkanaplonal (`worksheet-entry.ts`): a
 * kepernyore nincs komponens-teszt ebben az appban, tehat ami a torzsben
 * marad, azt csak kezzel lehetne kiprobalni -- ez a modul ezert HORDOZZA a
 * dontest, nem csak a formazast.
 *
 * A TIPUSOK SAJAT, SZERKEZETI ALAKOK: ez a fajl a teszt-forditasba is
 * bekerul, az pedig nem ismeri a `@/` aliast, tehat a `@acropora/types`
 * csomagot sem (amugy sem huzza be az Expo app, lasd `docs/MOBILE-
 * DEVELOPMENT.md`). A `MaterialRequestItem` nevei szandekosan a szerveret
 * masoljak (`packages/types/src/material-request-management.ts`), hogy a
 * ket oldal osszevetese olvasasra is elvegezhtő legyen.
 */

/** A hatar a szerveren all (`material-request.dto.ts`) -- ha ott valtozik, itt is. */
const NAME_MAX = 200;
const QUANTITY_MAX = 100;
const UNIT_MAX = 50;

export interface MaterialRequestItemInput {
  name: string;
  quantity: string;
  unit: string;
}

export interface MaterialRequestItemsResult {
  ok: boolean;
  items: MaterialRequestItemInput[];
  message: string | null;
}

/**
 * A FELVITT SOROK TISZTITASA ES ELLENORZESE.
 *
 * === A TELJESEN URES SOR NEM SZAMIT ===
 *
 * A szerelo tobb tetelt vesz fel egymas utan, es az utolso, meg ki nem
 * toltott sor NE torje el a kuldest -- pontosan ugy, ahogy a webes felvitel
 * is szuri (lasd `worksheet-material-requests.tsx`, `sendNew`).
 *
 * === A HIANYOS SOR IGEN ===
 *
 * Ha a szervezo elkezdett egy sort (barmelyik mezobe irt), de nem toltotte
 * ki mindharmat, az MAS eset: az ures sor kihagyhato, a felig kitoltott nem.
 */
export function buildMaterialRequestItems(
  rows: readonly MaterialRequestItemInput[],
): MaterialRequestItemsResult {
  const tisztitott = rows
    .map((sor) => ({
      name: sor.name.trim(),
      quantity: sor.quantity.trim(),
      unit: sor.unit.trim(),
    }))
    .filter((sor) => sor.name || sor.quantity || sor.unit);

  if (tisztitott.length === 0)
    return { ok: false, items: [], message: "Adj meg legalább egy tételt." };

  const hianyos = tisztitott.find(
    (sor) => !sor.name || !sor.quantity || !sor.unit,
  );
  if (hianyos)
    return {
      ok: false,
      items: [],
      message:
        "Minden felvitt tételnél töltsd ki a nevet, a mennyiséget és az egységet.",
    };

  const tulHosszu = tisztitott.find(
    (sor) =>
      sor.name.length > NAME_MAX ||
      sor.quantity.length > QUANTITY_MAX ||
      sor.unit.length > UNIT_MAX,
  );
  if (tulHosszu)
    return {
      ok: false,
      items: [],
      message: `A tétel neve legfeljebb ${NAME_MAX}, a mennyiség ${QUANTITY_MAX}, az egység ${UNIT_MAX} karakter lehet.`,
    };

  return { ok: true, items: tisztitott, message: null };
}

export type MaterialRequestStatusValue = "DRAFT" | "OPEN" | "RECEIVED";

export const MATERIAL_REQUEST_STATUS_LABEL: Record<
  MaterialRequestStatusValue,
  string
> = {
  DRAFT: "Piszkozat",
  OPEN: "Beszerzésre vár",
  RECEIVED: "Beérkezett",
};

/** Amennyit egy anyagigénylésből ez a modul olvas. */
export interface MaterialRequestLike {
  status: MaterialRequestStatusValue;
  requestedByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
}

/**
 * KI KERTE, MIKOR -- ES HA ELKULDVE VAGY BEERKEZETT, AZ IS.
 *
 * UGYANAZ A LOGIKA, MINT A WEBEN (`worksheet-material-request-presentation.ts`):
 * a DRAFT sor a `createdAt`-tal all, mert meg nincs kuldesi idopont. A tobbi
 * allapotnal a kuldes (es a beerkezes) ideje a lenyeges esemeny.
 */
export function materialRequestByline(
  request: MaterialRequestLike,
  formatDate: (iso: string) => string,
): string {
  const ki = request.requestedByName ?? "Ismeretlen kolléga";
  if (request.status === "DRAFT")
    return `${ki} · piszkozat, ${formatDate(request.createdAt)}`;
  const kuldve = formatDate(request.submittedAt ?? request.createdAt);
  if (request.status === "OPEN") return `${ki} · elküldve ${kuldve}`;
  const beerkezettSor = request.receivedAt
    ? ` · beérkezett ${formatDate(request.receivedAt)}${
        request.receivedByName ? ` (${request.receivedByName})` : ""
      }`
    : "";
  return `${ki} · elküldve ${kuldve}${beerkezettSor}`;
}

/**
 * AZ URES LISTA MONDATA -- ES MIERT NEM UGYANAZ A KET ESET.
 *
 * Ugyanaz a kulonbseg, mint `describeEmptyEntries`-nel: aki felvihet, biztatast
 * kap; aki nem, azt nem kerjuk olyanra, amihez nincs gombja.
 */
export function describeEmptyMaterialRequests(canWrite: boolean): string {
  return canWrite
    ? "Ezen a munkalapon még nincs anyagigény. Az Anyagigénylés gombbal viheted fel, mire van szükséged."
    : "Ezen a munkalapon még nincs anyagigény.";
}

/**
 * A MUNKALAP SORA A BESZERZO LISTAJAN.
 *
 * A munkalap piszkozatkent (meg nincs sorszama) is szerepelhet a beszerzo
 * listajan -- lasd a szerver `PendingMaterialRequest.worksheetNumber` mezojet.
 */
export function describePendingMaterialRequestWorksheet(
  worksheetNumber: string | null,
): string {
  return worksheetNumber
    ? `Munkalap: ${worksheetNumber}`
    : "Munkalap: még piszkozat";
}
