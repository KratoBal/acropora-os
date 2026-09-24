/**
 * A PARTNER BELSŐ KÓDJA -- AUTOMATIKUS KÉPZÉS, GYÖKÉR- ÉS BEÉPÍTETT ESZKÖZRE.
 *
 * Balázs kérése (2026-09-24, Szerviz és eszköznyilvántartás szál): "amiket mi
 * viszünk fel eszközöket azoknál nem generálódik le automatikusan a partner
 * belső kódja". A séma és a minta acrobot mérése
 * (`exchange/partner-kod-auto-meres-2026-09-24.md`, éles adat, 2026-09-24),
 * a gyökér-alak PEDIG Balázs 2026-09-24 11:33-i JÓVÁHAGYÁSÁVAL, szó szerint:
 * "ahogy a BIO alatti eszközöknél az első tag legyen BIO a FAN alattinál a
 * FAN stb stb pl FAN-A11-HSZ-01":
 *
 *   gyökér eszköz, a helyszín-fa MÉLYÉN:
 *     <legfelső helyszín kódja>-<saját helyszín kódja>-<kategória kódja>-<NN>
 *     (pl. FAN-A11-HSZ-01 -- a FAN/AKV/A11 fában, a KÖZBÜLSŐ AKV szint
 *     KIMARAD: Balázs saját példája is ezt az alakot adta, nem
 *     FAN-AKV-A11-HSZ-01-et)
 *   gyökér eszköz, KÖZVETLENÜL a legfelső szinten:
 *     <legfelső helyszín kódja>-<kategória kódja>-<NN>   (pl. CAP-HSZ-01 --
 *     a legfelső kód nem ismétlődik kétszer)
 *   beépített eszköz: <szülő partnerInternalCode>-<kategória kódja>-<NN>
 *                      (pl. FAN-A11-HSZ-01-VAL-05)
 *
 * Ez a fájl TISZTA FÜGGVÉNYEKET tart: az előtag összerakása és a legkisebb
 * szabad sorszám keresése adatbázis nélkül is mérhető. A DB-lekérdezés (a
 * kategória/helyszín/szülő kódjának lekérése, a helyszín-fa GYÖKERÉIG való
 * felfelé séta, a meglévő kódok listája, a versenyhelyzet elleni zár) a hívó
 * oldalán, a tranzakción belül történik -- lásd
 * `service-assets.repository.ts` `create()`-jét.
 */

/** A sorszám hossza, névvel, hogy ha Balázs mást mond, EGY helyen változzon. */
export const PARTNER_INTERNAL_CODE_SERIAL_DIGITS = 2;

/**
 * A DB-FÜGGETLEN KAPU: PRÓBÁLKOZZUNK-E EGYÁLTALÁN.
 *
 * Három feltétel, mindhárom a bemenetből (nincs adatbázis-lekérdezés):
 * szerviz partner tulajdonos, a mező ÜRES (a kézzel beírt érték SOHA nem
 * íródik felül -- ugyanaz a szabály, mint az `assetDepartmentPresenceRefusal`-
 * nél), és VAN kiválasztott kategória. A negyedik feltétel (a kategóriának
 * VAN-E kódja) csak adatbázisból dönthető el -- azt a hívó fél a tranzakción
 * belül, a kategória lekérdezésekor nézi meg (lásd
 * `service-assets.repository.ts` `create()`-jét).
 *
 * `PATCH`-nál (frissítéskor) ez a függvény NEM hívódik -- a kód frissítéskor
 * sosem generálódik, csak létrehozáskor.
 */
export function shouldGeneratePartnerInternalCode(input: {
  ownerType: "CUSTOMER" | "SUPPLIER";
  partnerInternalCode?: string | null;
  categoryId?: string | null;
}): boolean {
  if (input.ownerType !== "SUPPLIER") return false;
  if (input.partnerInternalCode && input.partnerInternalCode.trim() !== "")
    return false;
  if (!input.categoryId) return false;
  return true;
}

/**
 * AZ ELŐTAG: a szülő TELJES kódja, ha van (beépített eszköz), különben a
 * helyszín-fa gyökerének kódja PLUSZ a saját helyszín kódja, ha a kettő
 * különbözik (gyökér eszköz) -- mindkét esetben a kategória kódjával
 * összefűzve.
 *
 * AZ `isBuiltIn` A DÖNTŐ, NEM A `parentPartnerInternalCode === null`
 * ÖNMAGÁBAN: ez a mező különbözteti meg a "nincs szülő" (gyökér, a
 * helyszín-kódok számítanak) esetet a "van szülő, de annak nincs kódja"
 * (beépített, NEM generálunk) esettől -- a két eset `parentPartnerInternalCode`-ra
 * nézve ugyanúgy `null`, de más a helyes viselkedés.
 *
 * AZ `ownIsRootLocation` A DÖNTŐ A GYÖKÉR-ÁGON, NEM A KÉT KÓD ÉRTÉKÉNEK
 * EGYEZÉSE: a helyszín-kód csak TESTVÉREK között egyedi (lásd a séma
 * `WorksheetDepartment.@@unique([customerId, parentId, code])`-ját), tehát
 * egy MÁSIK ágon lévő helyszín kódja VÉLETLENÜL megegyezhetne a fa
 * gyökerének kódjával -- ha a döntés az érték-egyezésen múlna, ez hamis
 * dedupot okozna. A hívó ezért egy KIFEJEZETT logikai jelzőt ad át, ami a
 * `parentId IS NULL` tényből jön, nem a kódok összehasonlításából.
 *
 * `null`, HA NEM ÁLLÍTHATÓ ELŐ: beépített eszköznél, ha a szülőnek NINCS
 * kódja, NEM generálunk -- Balázs kifejezett kérése ("Ha a szülőnek nincs
 * kódja, NE generálj"), mert egy kód nélküli szülőre épülő gyermek-kód a
 * fát olvashatatlanná tenné. A helyszín kódja ilyenkor NEM pótolja a szülő
 * hiányzó kódját.
 */
export function partnerInternalCodePrefix(input: {
  isBuiltIn: boolean;
  parentPartnerInternalCode: string | null;
  rootLocationCode: string | null;
  ownLocationCode: string | null;
  ownIsRootLocation: boolean;
  categoryCode: string;
}): string | null {
  if (input.isBuiltIn) {
    if (input.parentPartnerInternalCode === null) return null;
    return `${input.parentPartnerInternalCode}-${input.categoryCode}`;
  }
  if (input.rootLocationCode === null) return null;
  if (input.ownIsRootLocation)
    return `${input.rootLocationCode}-${input.categoryCode}`;
  if (input.ownLocationCode === null) return null;
  return `${input.rootLocationCode}-${input.ownLocationCode}-${input.categoryCode}`;
}

/**
 * A LEGKISEBB SZABAD SORSZÁM, ADOTT ELŐTAGGAL -- NEM A DARABSZÁM.
 *
 * A meglévő kódok között LYUK is lehet (kézzel beírt, törölt vagy kihagyott
 * eszköz), tehát a helyes viselkedés a hiányzó szám MEGKERESÉSE, nem a
 * "darabszám + 1" -- az utóbbi egy lyuk után visszamenőleg ütközne egy már
 * létező, magasabb sorszámú kóddal.
 *
 * A SOROSZÁM-RÉSZ BÁRMENNYI SZÁMJEGYET ELFOGAD BEMENETKÉNT (nem csak
 * pontosan kettőt): egy kézzel beírt "A11-HSZ-1" ugyanazt a sorszámot
 * foglalja, mint a generált "A11-HSZ-01" -- ha csak a kétjegyű alakot
 * ismernénk fel, a két írásmód között csendben ütközés keletkezhetne.
 *
 * AZ OPCIONÁLIS `assetName` A RÓMAI SZÁMOS KIVÉTEL, Balázs szabálya, amit a
 * saját 131 eszközös visszatöltésén alkalmazott (2026-09-24 11:42, szó
 * szerint): "ha a név római szammal vegzodik (Lampa VI.) és az a sorszám
 * szabad, azt kapja (LIG-06), különben a legkisebb szabadot." Tehát a
 * névvégi római szám ELSŐBBSÉGET élvez a legkisebb-szabad kereséssel
 * szemben, DE csak ha a neki megfelelő sorszám még szabad -- ha foglalt, a
 * függvény visszaesik a szokásos legkisebb-szabad keresésre, nem hibázik.
 */
export function nextFreePartnerInternalCodeSerial(
  prefix: string,
  existingCodesWithPrefix: readonly string[],
  assetName?: string,
): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  const used = new Set<number>();
  for (const code of existingCodesWithPrefix) {
    const match = pattern.exec(code);
    if (match) used.add(Number(match[1]));
  }
  if (assetName !== undefined) {
    const romanSerial = trailingRomanNumeralValue(assetName);
    if (romanSerial !== null && !used.has(romanSerial))
      return `${prefix}-${String(romanSerial).padStart(PARTNER_INTERNAL_CODE_SERIAL_DIGITS, "0")}`;
  }
  let serial = 1;
  while (used.has(serial)) serial += 1;
  return `${prefix}-${String(serial).padStart(PARTNER_INTERNAL_CODE_SERIAL_DIGITS, "0")}`;
}

/**
 * A NÉV VÉGÉN, ÖNÁLLÓ SZÓKÉNT ÁLLÓ RÓMAI SZÁM ÉRTÉKE, VAGY `null`.
 *
 * SZIGORÚ FELISMERÉS, NEM TALÁLGATÁS: a bemenetet a kanonikus római alakra
 * VISSZA IS ALAKÍTJUK, és csak akkor fogadjuk el, ha a kettő betűre
 * egyezik -- ez veti ki az olyan hibás vagy nem-kanonikus alakokat, mint az
 * "IIII" (helyesen "IV") vagy a "VX" (nem érvényes római szám). Egy rosszul
 * felismert "szám" rossz sorszámot írna egy eszközre, ez pedig a névből
 * egy pillantással ellenőrizhető kell legyen, nem találgatás.
 *
 * ÖNÁLLÓ SZÓ: a római számnak a név VÉGÉN, szóköz (vagy a név eleje) után
 * kell állnia, opcionális záró ponttal ("Lampa VI." -> "VI") -- így egy
 * összetett szó belseje (pl. egy "MIX" nevű termék közepén álló betűk) nem
 * illeszkedik véletlenül.
 */
export function trailingRomanNumeralValue(name: string): number | null {
  const match = /(?:^|\s)([IVXLCDM]+)\.?\s*$/.exec(name.trim());
  if (!match) return null;
  return romanNumeralValue(match[1]!);
}

const ROMAN_NUMERAL_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

function romanNumeralValue(roman: string): number | null {
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = ROMAN_NUMERAL_VALUES[roman[index]!];
    const next =
      index + 1 < roman.length
        ? ROMAN_NUMERAL_VALUES[roman[index + 1]!]
        : undefined;
    if (current === undefined) return null;
    total += next !== undefined && current < next ? -current : current;
  }
  if (total <= 0 || toRomanNumeral(total) !== roman) return null;
  return total;
}

const ROMAN_NUMERAL_TABLE: readonly (readonly [number, string])[] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function toRomanNumeral(value: number): string {
  let remaining = value;
  let result = "";
  for (const [numeralValue, symbol] of ROMAN_NUMERAL_TABLE) {
    while (remaining >= numeralValue) {
      result += symbol;
      remaining -= numeralValue;
    }
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
