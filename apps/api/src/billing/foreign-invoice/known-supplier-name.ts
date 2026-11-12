/**
 * A SZÁLLÍTÓ NEVE A KORÁBBAN, EMBER ÁLTAL JÓVÁHAGYOTT SZÁMLÁKBÓL (kártya dbab22cd, harmadik kör; acrobot 48788 (2), 48791, 48793).
 *
 * MIÉRT: a PDF-ből olvasott szállítónév az új mintán 50-75 százalék, a hézag tipikusan olyan szállító, akinek egy korábbi számláját már ember
 * jóváhagyta (ugyanaz az adószám). Az adószámot az olvasó mindkét mintán 100 százalékban jól olvassa, tehát a kulcs megbízható. A mért lefedettség
 * az éles memórián (q5, q6): az EU adószámnál 17 a 35 sorból egyező névvel, a normalizálás (írásjelek) még 5-öt hoz; a magyar adószámnál 19 a 24-ből.
 *
 * A SZABÁLY, szigorúan:
 *   - csak az ÜRES nevet tölti (az olvasott, az illesztő és a párosítás neve elsőbbséget élvez; ez a hívó dolga),
 *   - a kulcs az EU adószám, ennek híján a magyar adószám (szóköz nélkül, nagybetűvel),
 *   - minden korábbi jóváhagyott név ugyanaz kell legyen a normalizálás után (kisbetű, pontok törölve, a többi írásjel szóköz): egyetlen eltérő név, és semmit
 *     nem tölt. Az "egyértelmű" itt azt jelenti: egy ember sem vitte be máshogy.
 *   - a kiírt alak a leggyakoribb nyers név, döntetlennél a legutóbb jóváhagyotté.
 *   - egyetlen korábbi sor is elég (egy ember már jóváhagyta ezt az adószámot ezzel a névvel); a hivatkozás a figyelmeztetésben áll.
 *
 * A SOROKAT A HÍVÓ SZŰRI: csak EMBER által jóváhagyott olvasat jöhet (`reviewedByUserId` nem null). Az automatikusan jóváhagyott sor is VERIFIED, de a neve a PDF-ből
 * olvasott, amit ember nem nézett meg; ha az is forrás lenne, a név saját magát erősítené ember nélkül (barracuda, #2471). Ez a függvény ezt nem látja.
 *
 * Tiszta függvény: nem olvas adatbázist; a sorokat a hívó adja (`IncomingReviewService`).
 */

export interface VerifiedSupplierRow {
  supplierName: string | null;
  supplierTaxNumber: string | null;
  supplierEuTaxNumber: string | null;
  /** a jóváhagyás ideje: döntetlennél a legújabb nyers név nyer */
  updatedAt?: Date | null;
}

export interface KnownSupplierName {
  /** a kiírandó név (a leggyakoribb nyers alak) */
  name: string;
  /** melyik adószám alapján (a figyelmeztetésbe) */
  taxNumber: string;
  /** hány korábbi jóváhagyott sor adta */
  rows: number;
}

/** Az adószám kulcsa: szóköz nélkül, nagybetűvel; üres: nincs kulcs. */
export function taxKey(value: string | null | undefined): string | null {
  const key = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return key || null;
}

/**
 * A név normalizált alakja (az "n2" lépés, acrobot 48793): kisbetű, a pontok törölve (b.v. -> bv), a többi nem betű-szám szóközre, a szóközök
 * összevonva. A cégforma-szavakat NEM töröljük (a mérés szerint nem hozott többet).
 */
export function nameKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replaceAll(".", "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Az adott adószámú, nem üres nevű korábbi sorok (az EU adószám a kulcs, ennek híján a magyar), vagy null, ha nincs kulcs vagy nincs ilyen sor. */
function matchingRows(
  rows: readonly VerifiedSupplierRow[],
  keys: {
    euTaxNumber: string | null | undefined;
    taxNumber: string | null | undefined;
  },
): { rows: VerifiedSupplierRow[]; taxNumber: string } | null {
  const eu = taxKey(keys.euTaxNumber);
  const hu = taxKey(keys.taxNumber);
  // az EU adószám a kulcs; csak ha az olvasatnak nincs, jön a magyar (egyik kulcsról sem esünk át a másikra: egy egyértelműtlen EU csoport nem kap magyar mentőövet)
  const [column, key] = eu
    ? (["supplierEuTaxNumber", eu] as const)
    : hu
      ? (["supplierTaxNumber", hu] as const)
      : [null, null];
  if (!column || !key) return null;
  const matching = rows.filter(
    (row) =>
      taxKey(row[column]) === key && nameKey(row.supplierName).length > 0,
  );
  return matching.length ? { rows: matching, taxNumber: key } : null;
}

/** A nyers nevek egy listában, a leggyakoribb elöl (döntetlennél a legutóbb jóváhagyott), a normalizált névenként egy alak. */
function rawNames(rows: readonly VerifiedSupplierRow[]): string[] {
  const byKey = new Map<
    string,
    Map<string, { count: number; latest: number }>
  >();
  for (const row of rows) {
    const name = row.supplierName!.trim().replace(/\s+/g, " ");
    const forms = byKey.get(nameKey(name)) ?? new Map();
    const entry = forms.get(name) ?? { count: 0, latest: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, row.updatedAt?.getTime() ?? 0);
    forms.set(name, entry);
    byKey.set(nameKey(name), forms);
  }
  const best = [...byKey.values()].map((forms) => {
    const [name, entry] = [...forms.entries()].sort(
      (a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest,
    )[0]!;
    return {
      name,
      count: [...forms.values()].reduce((n, e) => n + e.count, 0),
      latest: entry.latest,
    };
  });
  return best
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .map((entry) => entry.name);
}

export function knownSupplierName(
  rows: readonly VerifiedSupplierRow[],
  keys: {
    euTaxNumber: string | null | undefined;
    taxNumber: string | null | undefined;
  },
): KnownSupplierName | null {
  const group = matchingRows(rows, keys);
  if (!group) return null;
  const names = rawNames(group.rows);
  // két igazán különböző név: nincs egyértelmű név (a töltés semmit nem tölt)
  if (names.length > 1) return null;
  return {
    name: names[0]!,
    taxNumber: group.taxNumber,
    rows: group.rows.length,
  };
}

/**
 * A NÉV-ÜTKÖZÉS (kártya dbab22cd, harmadik kör; acrobot 48943/48944, barracuda 48941 és 49013): a PDF SZÖVEGÉBŐL olvasott név és az azonos adószámú, EMBER által jóváhagyott korábbi
 * nevek a `nameKey` után ütköznek, ha az olvasott név EGYIK korábbi névvel sem egyezik. Egyértelmű előzménynél (egy név) ez az eltérés; KÉTÉRTELMŰ előzménynél (több, egymástól eltérő
 * ember által jóváhagyott név ugyanarra az adószámra) a szigorúbb alak: egy harmadik, mindegyiktől eltérő szöveges név is ütközés, ha viszont az olvasott név az egyikkel egyezik, nincs.
 * A visszaadott érték a korábbi név (kétértelmű előzménynél a nevek " / "-lel elválasztva; a figyelmeztetésbe és az automatikus jóváhagyás okába); `null`: nincs ütközés (nincs olvasott
 * név, nincs korábbi név az adószámra, vagy az olvasott név egyezik valamelyikkel). A hívó dönti el, MELY nevekre kéri (csak a szövegből olvasottra, nem a párosítás vagy a lookup nevére).
 */
export function supplierNameConflict(
  rows: readonly VerifiedSupplierRow[],
  values: {
    supplierName: string | null;
    supplierEuTaxNumber: string | null;
    supplierTaxNumber: string | null;
  },
): KnownSupplierName | null {
  const read = nameKey(values.supplierName);
  if (!read) return null;
  const group = matchingRows(rows, {
    euTaxNumber: values.supplierEuTaxNumber,
    taxNumber: values.supplierTaxNumber,
  });
  if (!group) return null;
  if (group.rows.some((row) => nameKey(row.supplierName) === read)) return null;
  return {
    name: rawNames(group.rows).join(" / "),
    taxNumber: group.taxNumber,
    rows: group.rows.length,
  };
}
