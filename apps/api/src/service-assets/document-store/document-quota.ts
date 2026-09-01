/**
 * A FOTÓ-TÁRHELY KERETE: belefér-e még egy feltöltés, és szólni kell-e nekünk.
 *
 * TISZTA FÜGGVÉNY, ADATBÁZIS NÉLKÜL. A felhasznált helyet a hívó adja be, egy
 * `SUM("sizeBytes")` értékként a táblából -- nem könyvtár-bejárásból. A kettő
 * nem ugyanaz: a bejárás a lemezt olvassa (lassú, és a mennyisége a fájlok
 * számával nő), az összegzés egy indexelt oszlopot, és ugyanazt a számot adja,
 * amit a sorok állítanak magukról. Ha a kettő eltér, az MÁSIK hiba (elárvult
 * fájl vagy elveszett sor), és nem a keret dolga megtalálni.
 *
 * A KÉT ÜZENET KÉT KÜLÖNBÖZŐ EMBERNEK SZÓL, és ezért két külön állapot:
 *
 * - a `warn` NEKÜNK szól, jóval a baj előtt, hogy legyen idő helyet szerezni;
 *   a feltöltő ebből semmit nem lát, mert neki nincs is mit tennie
 * - a `reject` a FELTÖLTŐNEK szól, és megnevezi, hogy a fotó-tárhely telt be.
 *   Egy általános „a feltöltés nem sikerült" ugyanezt a helyzetet
 *   megkülönböztethetetlenné tenné egy hálózati hibától, és a felhasználó
 *   újrapróbálná, amíg fel nem adja.
 */
export interface QuotaDecision {
  state: "ok" | "warn" | "reject";
  /** A feltöltés UTÁNI összeg, bájtban. Elutasításnál a hipotetikus érték. */
  usedAfterBytes: number;
  /** A keret hányad része lenne foglalt, 0 és 1 fölött is (elutasításnál >1). */
  usedRatio: number;
  /** Emberi mondat: `warn` esetén nekünk, `reject` esetén a feltöltőnek. */
  reason?: string;
}

/**
 * A JELZÉSI KÜSZÖB. A feltöltés UTÁNI állapotra vonatkozik, nem az előttire:
 * az érdekes pillanat az, amikor egy feltöltés ÁTVISZI a határon, nem az,
 * amikor már fölötte vagyunk.
 */
export const QUOTA_WARN_RATIO = 0.8;

export function decideQuota(input: {
  usedBytes: number;
  incomingBytes: number;
  limitBytes: number;
}): QuotaDecision {
  const { usedBytes, incomingBytes, limitBytes } = input;

  // ÉRTELMETLEN BEMENET NEM DÖNTÉS, HANEM HIBA. Egy negatív méret vagy egy
  // nulla keret mellett minden válasz félrevezető lenne: a `reject` azt
  // sugallná, hogy a tárhely telt be, az `ok` pedig átengedne egy olyan
  // feltöltést, amiről semmit nem tudunk.
  if (!Number.isFinite(usedBytes) || usedBytes < 0) {
    throw new Error(`A felhasznált hely nem értelmezhető: ${usedBytes}`);
  }
  if (!Number.isFinite(incomingBytes) || incomingBytes < 0) {
    throw new Error(`A feltöltés mérete nem értelmezhető: ${incomingBytes}`);
  }
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    throw new Error(`A keret nem értelmezhető: ${limitBytes}`);
  }

  const usedAfterBytes = usedBytes + incomingBytes;
  const usedRatio = usedAfterBytes / limitBytes;

  // A KERET PONTOS ELÉRÉSE MÉG BELEFÉR. A keret azt mondja meg, mennyi HELY
  // van, nem azt, hogy meddig szabad elmenni: egy pontosan telire töltött
  // tárhely nem hibás állapot.
  if (usedAfterBytes > limitBytes) {
    return {
      state: "reject",
      usedAfterBytes,
      usedRatio,
      reason: `Betelt a fotó-tárhely: ${formatBytes(usedBytes)} van használatban a ${formatBytes(limitBytes)} keretből, és ez a fájl ${formatBytes(incomingBytes)}.`,
    };
  }

  if (usedRatio >= QUOTA_WARN_RATIO) {
    return {
      state: "warn",
      usedAfterBytes,
      usedRatio,
      reason: `A fotó-tárhely ${Math.round(usedRatio * 100)} százaléka foglalt (${formatBytes(usedAfterBytes)} a ${formatBytes(limitBytes)} keretből).`,
    };
  }

  return { state: "ok", usedAfterBytes, usedRatio };
}

/**
 * A MÉRET EMBERI ALAKJA. Kettes hatványok szerint, mert a keretet is így
 * mondjuk ki, és két különböző számolás ugyanarra a bájtra két különböző
 * számot adna a hibaüzenetben.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
