/**
 * MENNYI ADATLAP CSOPORTOSÍTHATÓ GÉPPEL — a `genus` kitöltöttségének mérője.
 *
 * MIÉRT MÉR ÉS NEM ELLENŐRIZ. A megtagadás-audit (`datasheet-refusal-audit.ts`)
 * KAPU: az elvárt értéke NULLA, mindig, ma is. Ez a modul MÉRŐ: az elvárt értéke
 * ma NEM nulla, és akkor csökken, ahogy a kitöltés halad. A kettő életciklusa
 * ellentétes, ezért nem futhatnak egy parancsban — egy kapu, amit a kitöltés
 * ideje alatt nem lehet meghúzni, nem kapu.
 *
 * MIT MÉR. Azt, hogy egy későbbi faj-szintű entitás (`Species`) bevezetésekor
 * hány adatlap csoportosítható GÉPPEL, és hány igényel EMBERI döntést. A
 * csoportosítás kulcsa a `genus`; ahol az hiányzik vagy eltérő írásmódú, ott a
 * gép nem tud párt találni.
 *
 * A SZABÁLY, AMIT MÉR, a séma kommentjében áll a `genus` oszlop mellett.
 */

export type FillStateDatasheet = {
  id: string;
  genus: string | null;
  species: string | null;
};

export type FillState = {
  total: number;
  /** Gépi csoportosításra alkalmas: van `genus`, és az írásmódja kanonikus. */
  groupable: number;
  /** Nincs `genus` (üres vagy csak szóköz): a csoportosítás emberi döntés. */
  missingGenus: string[];
  /**
   * Van `genus`, de az írásmódja eltér egy másik sorétól — csak kis/nagybetűben
   * vagy szóközben. Ezek EGYETLEN nemzetségre vonatkoznak, de a gép háromnak
   * látja őket.
   */
  inconsistentGenus: { canonical: string; spellings: string[] }[];
  /**
   * `genus` van, `species` nincs: NEM hiba, hanem a sémában kimondott jelentés
   * (nemzetség-szintű azonosítás). Külön számoljuk, mert ezek a sorok
   * csoportosíthatók, DE egymással soha nem vonhatók össze.
   */
  genusLevelOnly: number;
};

const canonical = (value: string) => value.trim().toLowerCase();

export function measureFillState(
  sheets: readonly FillStateDatasheet[],
): FillState {
  const missingGenus: string[] = [];
  const spellingsByCanonical = new Map<string, Set<string>>();
  let groupable = 0;
  let genusLevelOnly = 0;

  for (const sheet of sheets) {
    /**
     * A NYERS ÉRTÉKET TARTJUK MEG, NEM A LEVÁGOTTAT — és ezt egy teszt fogta
     * meg a saját kódomon. Az első változat `trim()`-elt, mielőtt a
     * változatokat gyűjtötte volna, tehát az `"Acropora "` és az `"Acropora"`
     * EGYNEK látszott. Egy `GROUP BY genus` viszont KETTŐNEK látja őket: a
     * záró szóköz épp olyan csoportosítás-törő, mint egy kisbetű.
     */
    const raw = sheet.genus ?? "";
    if (raw.trim().length === 0) {
      missingGenus.push(sheet.id);
      continue;
    }
    groupable += 1;
    if ((sheet.species?.trim() ?? "") === "") genusLevelOnly += 1;

    const key = canonical(raw);
    const seen = spellingsByCanonical.get(key);
    if (seen) seen.add(raw);
    else spellingsByCanonical.set(key, new Set([raw]));
  }

  const inconsistentGenus = [...spellingsByCanonical.entries()]
    .filter(([, spellings]) => spellings.size > 1)
    .map(([key, spellings]) => ({
      canonical: key,
      spellings: [...spellings].sort(),
    }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));

  return {
    total: sheets.length,
    groupable,
    missingGenus,
    inconsistentGenus,
    genusLevelOnly,
  };
}

/**
 * A JELENTÉS SZÖVEGE, ÉS AMIÉRT NEM „HIBA" SZÓVAL BESZÉL.
 *
 * Ez a parancs a kitöltés KÖZBEN fut, amikor a nem nulla érték a NORMÁLIS
 * állapot. Ha a szövege hibaként beszélne róla, a futtatója megtanulná figyelmen
 * kívül hagyni — és akkor a végén sem venné észre, amikor tényleg elakadt.
 */
export function describeFillState(state: FillState): string {
  const lines = [
    `${state.total} adatlap, ebből ${state.groupable} csoportosítható géppel.`,
  ];

  /**
   * A MÉRŐ KIMONDJA MAGÁRÓL, MIKOR NEM TUD ELBUKNI.
   *
   * Egy nulla eredmény kétféle: vagy tényleg rendben van minden, vagy a mérés
   * nem látott semmit. A kettő a kimeneten EGYFORMÁN nézne ki, és a második
   * esetben a zöld sor arról szólna, hogy nincs mit mérni — nem arról, hogy jó.
   *
   * Ezért az üres eset SAJÁT mondatot kap, és a tiszta eset is megnevezi, hol
   * áll a bizonyíték arra, hogy ez a mérő egyáltalán KÉPES találni: nem ebben a
   * futásban, hanem a specjében, ahol szándékos hibák pirosra viszik.
   */
  if (state.total === 0)
    lines.push(
      `EGYETLEN ADATLAP SEM VOLT: ez a futás a kitöltöttségről SEMMIT nem ` +
        `mond. Nem azt jelenti, hogy rendben van — azt, hogy nincs mit mérni.`,
    );
  else if (
    state.missingGenus.length === 0 &&
    state.inconsistentGenus.length === 0
  )
    lines.push(
      `Ebben a futásban nincs találat. Hogy ez a mérő KÉPES találni, azt nem ez ` +
        `a futás bizonyítja, hanem a datasheet-fill-state.spec.ts: ott ` +
        `szándékos hibák (levágott írásmód, hiányzónak vett genus) pirosra ` +
        `viszik. Egy nulla önmagában a kérdés tulajdonsága is lehet.`,
    );

  if (state.missingGenus.length > 0)
    lines.push(
      `${state.missingGenus.length} adatlapon NINCS genus, ezek csoportosítása ` +
        `emberi döntés lesz: ${state.missingGenus.join(", ")}`,
    );

  for (const entry of state.inconsistentGenus)
    lines.push(
      `A(z) "${entry.canonical}" nemzetség ${entry.spellings.length} különböző ` +
        `írásmóddal szerepel, és a gép ennyi külön nemzetségnek látja: ` +
        `${entry.spellings.map((value) => `"${value}"`).join(", ")}`,
    );

  if (state.genusLevelOnly > 0)
    lines.push(
      `${state.genusLevelOnly} adatlap nemzetség-szintű (a species szándékosan ` +
        `üres). Ez NEM hiányos kitöltés — de ezek a sorok egymással SOHA nem ` +
        `vonhatók össze: két "faj ismeretlen" nem ugyanaz a faj.`,
    );

  return lines.join("\n");
}
