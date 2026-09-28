/**
 * A NAV SZAMLASOR FORRASA A BESZERZESI SZAMLASORON (#1199 A-007).
 *
 * A kesobbi szamlasor-parositas ground truth-ja: melyik NAV sorbol (sorszam)
 * es milyen EREDETI szovegbol lett a mi sorunk. A `sourceDescription` erre
 * nem jo, mert a feluleten szerkesztheto, es termeknevre eshet vissza.
 *
 * A SZOVEG A TAROLT NAV ADATBOL JON (`NavIncomingInvoice.parsedData`), nem a
 * klienstol: a kliens csak a sorszamot kuldi, es az is csak akkor ervenyes,
 * ha a NAV adatban pontosan egy ilyen sorszamu sor all. Minden mas esetben a
 * ket mezo `null` -- a mentes soha nem akad el rajta.
 */

export interface NavSourceLine {
  /** `null`, ha a NAV adatban nem ertelmes egesz sorszam all. */
  readonly lineNumber: number | null;
  readonly description: string;
}

export interface NavLineSource {
  readonly navLineNumber: number | null;
  readonly navLineDescription: string | null;
}

export const NO_NAV_LINE_SOURCE: NavLineSource = {
  navLineNumber: null,
  navLineDescription: null,
};

/** Az `Int` oszlop felso hatara: nagyobb sorszamot nem tarolunk. */
const MAX_LINE_NUMBER = 2_147_483_647;

function ervenyesSorszam(ertek: unknown): number | null {
  return typeof ertek === "number" &&
    Number.isInteger(ertek) &&
    ertek >= 1 &&
    ertek <= MAX_LINE_NUMBER
    ? ertek
    : null;
}

/**
 * A `parsedData.lines` elemei, amiknek van szoveguk. `null`, ha nincs
 * hasznalhato NAV adat (nincs lekerve, vagy mas az alakja).
 */
export function navSourceLines(parsedData: unknown): NavSourceLine[] | null {
  if (typeof parsedData !== "object" || parsedData === null) return null;
  const lines = (parsedData as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return null;
  return lines.flatMap((line: unknown) => {
    if (typeof line !== "object" || line === null) return [];
    const { lineNumber, description } = line as {
      lineNumber?: unknown;
      description?: unknown;
    };
    if (typeof description !== "string" || description.length === 0) return [];
    return [{ lineNumber: ervenyesSorszam(lineNumber), description }];
  });
}

/** Egy uj sor forrasa a kliens altal kuldott NAV sorszambol. */
export function navLineSource(
  lines: readonly NavSourceLine[] | null,
  navLineNumber: number | undefined,
): NavLineSource {
  if (!lines || navLineNumber === undefined) return NO_NAV_LINE_SOURCE;
  const talalat = lines.filter((line) => line.lineNumber === navLineNumber);
  const egy = talalat.length === 1 ? talalat[0] : undefined;
  return egy
    ? { navLineNumber, navLineDescription: egy.description }
    : NO_NAV_LINE_SOURCE;
}

export interface ExistingPurchaseLine {
  readonly id: string;
  readonly sourceDescription: string | null;
  readonly navLineNumber: number | null;
}

export interface NavLinePairing {
  readonly pairs: ReadonlyArray<{ readonly id: string } & NavLineSource>;
  /** Miert maradt `null` egy sor. Osszesen = a szamla sorai - `pairs`. */
  readonly skipped: {
    /** Mar ki van toltve: nem irjuk felul. */
    readonly alreadySet: number;
    /** Nincs szovege (termekhez kotott sor megnevezes nelkul). */
    readonly noText: number;
    /** A szovege nem egyezik egyetlen NAV sorral sem (atirtak, vagy kezi sor). */
    readonly noMatch: number;
    /** A szoveg tobbszor all a NAV adatban vagy a mi sorainkon. */
    readonly ambiguous: number;
    /** Egyezik, de a NAV sor sorszama nem ertelmes egesz. */
    readonly invalidLineNumber: number;
  };
}

function darab(szovegek: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of szovegek) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

/**
 * A MEGLEVO SOROK VISSZATOLTESE, EGY SZAMLAN BELUL. Csak az egyertelmu par
 * kap erteket: a mi sorunk szovege PONTOSAN egyezik egy NAV sor szovegevel,
 * es a szoveg mindket oldalon egyszer fordul elo. Minden mas `null` marad,
 * es az ok szamolva van.
 *
 * A pontos egyezes szandekos: a mentes a szoveget a NAV-parser kimenetebol
 * veszi, es ugyanazzal a levagassal tarolja, tehat egy ervenyes par
 * betu szerint azonos. Egy hasonlo, de atirt szoveg nem bizonyitek.
 */
export function pairExistingLines(
  ourLines: readonly ExistingPurchaseLine[],
  navLines: readonly NavSourceLine[],
): NavLinePairing {
  const navDarab = darab(navLines.map((line) => line.description));
  const miDarab = darab(
    ourLines.flatMap((line) =>
      line.sourceDescription === null ? [] : [line.sourceDescription],
    ),
  );
  const pairs: Array<{ id: string } & NavLineSource> = [];
  const skipped = {
    alreadySet: 0,
    noText: 0,
    noMatch: 0,
    ambiguous: 0,
    invalidLineNumber: 0,
  };
  for (const line of ourLines) {
    if (line.navLineNumber !== null) {
      skipped.alreadySet++;
      continue;
    }
    const szoveg = line.sourceDescription;
    if (szoveg === null || szoveg.length === 0) {
      skipped.noText++;
      continue;
    }
    const nav = navDarab.get(szoveg) ?? 0;
    if (nav === 0) {
      skipped.noMatch++;
      continue;
    }
    if (nav > 1 || (miDarab.get(szoveg) ?? 0) > 1) {
      skipped.ambiguous++;
      continue;
    }
    const par = navLines.find((l) => l.description === szoveg);
    if (!par || par.lineNumber === null) {
      skipped.invalidLineNumber++;
      continue;
    }
    pairs.push({
      id: line.id,
      navLineNumber: par.lineNumber,
      navLineDescription: par.description,
    });
  }
  return { pairs, skipped };
}
