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
 */
export function nextFreePartnerInternalCodeSerial(
  prefix: string,
  existingCodesWithPrefix: readonly string[],
): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  const used = new Set<number>();
  for (const code of existingCodesWithPrefix) {
    const match = pattern.exec(code);
    if (match) used.add(Number(match[1]));
  }
  let serial = 1;
  while (used.has(serial)) serial += 1;
  return `${prefix}-${String(serial).padStart(PARTNER_INTERNAL_CODE_SERIAL_DIGITS, "0")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
