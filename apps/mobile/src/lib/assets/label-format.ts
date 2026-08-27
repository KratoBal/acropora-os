/**
 * A QR-CÍMKE GEOMETRIÁJA: EGY BEMENET, MINDEN MÁS LEVEZETÉS.
 *
 * A szalag 24 mm SZÉLES (Balázs, 2026-08-26), és folytonos. Ebből két dolog
 * következik, és a mai 30x30 mm-es négyzet mindkettőt elrontja: a magasság
 * kötött (a szalag keresztirányban ennyi), a HOSSZ viszont szabad.
 *
 * EZÉRT NINCS TÖBB KÜLÖN "QR-MÉRET" KONSTANS. A lapméret a bemenet, a kód
 * mérete abból SZÁMOLÓDIK -- a belső margó és a feliratsáv levonásával. Amíg két
 * szabad szám állt egymás mellett (`LABEL_SIZE_MM` és `LABEL_QR_SIZE_MM`),
 * előbb-utóbb valaki az egyiket írta volna át, és a kód kilógott volna a
 * szalagról úgy, hogy semmi nem jelzi: a PDF elkészül, a nyomtatás lefut, és
 * csak a beolvasás bukik el a helyszínen.
 *
 * AMIT NEM TUDUNK, ÉS NEM IS TALÁLGATUNK: a ténylegesen NYOMTATHATÓ sáv
 * magassága. A 24 mm a szalag fizikai szélessége; a nyomtatófej ennél
 * keskenyebb sávot ír. A hivatalos Brother értéket nem sikerült forrásból
 * igazolni (a dokumentációs tartomány nincs a letöltési engedélylistán), ezért
 * itt a MÉRT adat áll: a szalag szélessége. Az első nyomtatás mutatja meg,
 * mennyi vész el a széleken -- és azt is, hogy a nyomtató alkalmazása levág
 * vagy arányosan kicsinyít. Addig egyik állítás sem tekinthető ismertnek.
 */

/**
 * BEMENET 1: a lap MAGASSÁGA, a szalag keresztirányában, milliméterben.
 *
 * Ez a szalag szélessége. Ha az első nyomtatás azt mutatja, hogy a fej ennél
 * keskenyebb sávot ír ÉS levág (nem kicsinyít), ez az egyetlen szám áll át, és
 * a QR mérete, a modul-méret meg a feliratsáv magától követi.
 */
export const LABEL_BAND_MM = 24;

/**
 * BEMENET 2: a lap HOSSZA, a szalag irányában, milliméterben.
 *
 * A szalag folytonos, tehát ezt nem a nyomtató korlátozza, hanem az, hogy mi
 * fér ki olvashatóan. Az érték a CÍMKÉRE KERÜLŐ, rövidített azonosító hosszából
 * jön (lásd `labelAssetNumber`): 11 karakter, ami 3 mm-es betűvel egy sorban
 * kifér, tartalékkal. A teljes, 25 karakteres eszközszám 72 mm-t kért volna.
 *
 * A méret a LEGSZÉLESEBB lehetséges azonosítóra áll, nem egy mintára: a
 * véletlen rész hexa, és az `A`-tól `D`-ig tartó betűk szélesebbek a
 * számjegyeknél. Egy mintával mérve a címke azoknál az eszközöknél lógna ki,
 * amelyek véletlenül csupa betűs véget kaptak -- vagyis ritkán és
 * kiszámíthatatlanul.
 *
 * Balázs döntése (2026-08-26): a címkén elég a szám vége. A rövidítés MÉRTÉKÉT
 * viszont nem az ízlés szabja meg, hanem az egyediség -- lásd `labelAssetNumber`.
 */
export const LABEL_LENGTH_MM = 48;

/** BEMENET 3: belső margó minden oldalon. */
export const LABEL_PADDING_MM = 1.5;

/** BEMENET 4: rés a kód és a feliratsáv között. */
export const LABEL_GAP_MM = 1.5;

/** BEMENET 5: az eszközszám betűmérete. Ez a címke azonosító sora. */
export const LABEL_NUMBER_FONT_MM = 3;

/** BEMENET 6: a név betűmérete. Ez elfér kevesebbel, mert kiegészítő adat. */
export const LABEL_NAME_FONT_MM = 2.2;

/**
 * A SZIMBÓLUM SZÉLESSÉGE MODULBAN, a csendes zónával együtt.
 *
 * NEM a mi választásunk: a szerver `createAssetQrSvg` fix Version 5 szimbólumot
 * ad (37 x 37 modul), és 4 modulnyi csendes zónát rajzol köré, tehát a
 * `viewBox` 45 egység széles. A mi mm-ünk erre a 45-re oszlik.
 *
 * Ez a szám MÁSHOL él (`apps/api/src/service-assets/qr-svg.ts`), ezért a
 * spec-fájl visszaolvassa onnan. Ha a szerver verziót vált, a modul-méret
 * megváltozik anélkül, hogy itt bármi módosulna -- az az eset legyen piros,
 * ne meglepetés a nyomtatónál.
 */
export const QR_MODULES_ACROSS = 45;

/**
 * A NYOMTATÓ PONTRÁCSA, MILLIMÉTERBEN: 1/60 HÜVELYK.
 *
 * NEM a mi választásunk, hanem a felbontásoké. Egy szalagnyomtató 180, 300 vagy
 * 360 dpi-vel ír, és 1/60 hüvelyk MINDHÁROMON egész számú pont (3, 5, illetve
 * 6). Ez az a legnagyobb közös lépés, amivel a modul-háló akkor is pontosan a
 * pontrácsra ül, ha a készülék felbontását nem ismerjük -- és a PT-P710BT
 * esetében nem ismerjük: a gyártói lapból nem sikerült igazolni.
 *
 * AMIT EZ NEM AD: nem garantál beolvashatóságot. A modul MÉRETE dönt arról
 * (lásd `QR_MIN_MODULE_MM`), a rács csak arról, hogy a modulok EGYFORMÁK
 * legyenek. A kettő külön kérdés, és mindkettő az első nyomtatáson mérhető.
 */
export const MODULE_GRID_MM = 25.4 / 60;

/**
 * KEREKÍTÉSI TARTALÉK: EGY CSS KÉPPONT, MILLIMÉTERBEN.
 *
 * A mért hiba (2026-08-26 este): a kinyomtatott PDF KÉT oldalas lett, a második
 * teljesen üres, és a nyomtató alkalmazása nem fogadta el. Mindkét oldal 48 x 24
 * mm volt, tehát a lapméret rendben van; a baj az, hogy a tartalom PONTOSAN
 * annyi volt, mint a lap, mindkét irányban, nulla tartalékkal.
 *
 * Egy nyomtatási elrendezés viszont nem milliméterben számol, hanem képpontban.
 * A CSS képpont a formátum szerint 1/96 hüvelyk, és a 21 mm-es QR ezen 79,3701
 * képpont -- NEM egész szám. Ha az elrendezés felfelé kerekíti egész képpontra,
 * a tartalom 0,63 képponttal magasabb lesz a lapnál, és a nyomtatás ÚJ OLDALT
 * nyit. Az új oldal üres, mert a túllógás maga üres.
 *
 * Ezért a levezetés egy CSS képpontnyi helyet meghagy mindkét irányban: ennyi az
 * a legnagyobb ár, amit egy felfelé kerekítés kérhet. Ez nem varázsszám, hanem
 * maga a mechanizmus mértéke.
 */
export const LABEL_ROUNDING_ALLOWANCE_MM = 25.4 / 96;

/**
 * A MODUL ALSÓ HATÁRA, milliméterben. IRODALMI ÉRTÉK, NEM A MI MÉRÉSÜNK.
 *
 * Telefonkamerás beolvasásnál a szokásos alsó határ 0,3 mm körül van. Ez nem
 * bizonyíték, hanem küszöb: ami ez alá esik, azt nem érdemes kinyomtatni sem.
 * Az elfogadás feltétele változatlanul az ELSŐ próbálkozásra sikeres beolvasás.
 */
export const QR_MIN_MODULE_MM = 0.3;

export type LabelLayout = {
  /** A lap hossza (a szalag irányában), mm. */
  pageWidthMm: number;
  /** A lap magassága (a szalag keresztirányában), mm. */
  pageHeightMm: number;
  /** A QR rajz oldalhossza, mm. A csendes zóna EBBEN VAN BENNE. */
  qrSizeMm: number;
  /** A feliratsáv szélessége a kód mellett, mm. */
  textWidthMm: number;
  /** Ami a lap MAGASSÁGÁBÓL üresen marad. Kerekítési tartalék, nem dísz. */
  heightSlackMm: number;
  /** Ami a lap HOSSZÁBÓL üresen marad. */
  widthSlackMm: number;
  /** Egy QR-modul oldalhossza, mm. Ez az egyetlen szám, ami a beolvashatóságról szól. */
  moduleMm: number;
};

/**
 * A LEVEZETÉS. Fekvő elrendezés: a kód megkapja a teljes magasságot, a felirat
 * a mellette maradó sávot.
 *
 * Ez a fekvő alaknak az a nyeresége, amit a négyzet nem engedett: álló
 * elrendezésben (felirat a kód ALATT) a szövegsáv a magasságból venne el, tehát
 * pontosan abból, amiből a modul-méret származik.
 */
export function labelLayout(): LabelLayout {
  /**
   * A TARTALÉK MINDKÉT IRÁNYBAN LEJÖN, és nem utólagos korrekcióként, hanem a
   * levezetés részeként. Ha a lapból utólag vonnánk le, két szám mondaná meg
   * ugyanazt, és az egyikük elcsúszása néma lenne.
   */
  const availableMm =
    LABEL_BAND_MM - 2 * LABEL_PADDING_MM - LABEL_ROUNDING_ALLOWANCE_MM;

  /**
   * A MODUL A NYOMTATÓ PONTRÁCSÁRA ÜL, ÉS EZ A LEGNAGYOBB, AMI BELEFÉR.
   *
   * A rendelkezésre álló magasságot NEM osztjuk szét maradék nélkül: az abból
   * jövő modul (0,4608 mm) egyik szóba jövő felbontáson sem egész számú pont
   * (180 dpi-n 3,27, 300-on 5,44, 360-on 6,53), tehát a raszterizálás egyes
   * modulokat 3, másokat 4 pont szélesre kerekít. A szimbólum ettől nem lesz
   * olvashatatlan, de a modul-rács egyenetlen lesz -- és a beolvasás pont a
   * rossz pillanatban romlik el.
   *
   * Ezért a modul a `MODULE_GRID_MM` egész számú többszöröse, és abból a
   * legnagyobb, ami még belefér. A rács azért 1/60 hüvelyk, mert az MINDEN
   * 60-nal osztható felbontáson egész pont: 180-on 3, 300-on 5, 360-on 6 --
   * vagyis a döntéshez NEM kell tudnunk a nyomtató felbontását, amit a gyártói
   * lapból nem sikerült igazolni.
   */
  const gridSteps = Math.floor(
    availableMm / QR_MODULES_ACROSS / MODULE_GRID_MM,
  );
  if (gridSteps < 1)
    throw new Error(
      `A szalag nem elég széles egy modulnyi rácshoz: ${availableMm} mm.`,
    );
  const moduleMm = gridSteps * MODULE_GRID_MM;
  const qrSizeMm = moduleMm * QR_MODULES_ACROSS;

  const textWidthMm =
    LABEL_LENGTH_MM -
    2 * LABEL_PADDING_MM -
    qrSizeMm -
    LABEL_GAP_MM -
    LABEL_ROUNDING_ALLOWANCE_MM;

  return {
    pageWidthMm: LABEL_LENGTH_MM,
    pageHeightMm: LABEL_BAND_MM,
    qrSizeMm,
    textWidthMm,
    moduleMm,
    heightSlackMm: LABEL_BAND_MM - 2 * LABEL_PADDING_MM - qrSizeMm,
    widthSlackMm:
      LABEL_LENGTH_MM -
      (2 * LABEL_PADDING_MM + qrSizeMm + LABEL_GAP_MM + textWidthMm),
  };
}

/**
 * A CÍMKÉN RÖVIDÍTETT AZONOSÍTÓ ÁLL, NEM A TELJES ESZKÖZSZÁM.
 *
 * EZ ITT KELETKEZIK. Ha valaki egy kinyomtatott címkét keres vissza, a
 * rövidített alakot fogja beírni, és tudnia kell, hogy az nem a teljes szám.
 *
 * A TELJES SZÁM ALAKJA (`apps/api/src/common/code-generator.util.ts`):
 * `ESZK-20260815-113856-3906`, vagyis előtag, dátum, időpont és egy négyjegyű
 * véletlen rész. A címkére az UTOLSÓ KÉT BLOKK kerül: `113856-3906`.
 *
 * MIÉRT KETTŐ, ÉS MIÉRT NEM CSAK AZ UTOLSÓ. A négyjegyű rész 16 bit véletlen
 * (a `randomUUID` eleje, mérve: 200 ezer húzásból 62 428 különböző érték a
 * 65 536-ból, vagyis egyenletes). Ennyiből 302 eszköznél már 50 százalék az
 * esély, hogy két eszköz UGYANAZT a címkét kapja. Az időponttal együtt a tér
 * 86 400-szor nagyobb, és ugyanez az esély tízezer eszköznél is 1 százalék
 * alatt marad. A dátum blokk elhagyása tehát olcsó, az időponté nem.
 *
 * AMIT EZ NEM AD: garanciát. Egyediséget csak a TELJES számra köt az adatbázis
 * (`assetNumber @unique`). A maradék eset az, ha két eszköz KÜLÖNBÖZŐ NAPON,
 * ugyanabban a másodpercben, ugyanazzal a véletlen véggel születik.
 *
 * ÉS AMIÉRT A VISSZAKERESÉS MŰKÖDIK: a rövidített alak a teljes szám VÉGE,
 * vagyis összefüggő részlete. Az eszközkereső `contains` illesztést használ
 * (`service-assets.repository.ts`), tehát a címkéről beírt `113856-3906`
 * megtalálja a teljes számot, minden további változtatás nélkül.
 *
 * FIGYELEM, AMI NEM LÁTSZIK RAJTA: az időpont UTC, mert a szerver
 * `toISOString()` alapján állítja elő. A címkén álló `113856` tehát nyáron
 * 13:38:56 budapesti időnek felel meg. Ez azonosítónak jó, órának nem.
 */
export function labelAssetNumber(assetNumber: string): string {
  const blocks = assetNumber.split("-");

  // Ismeretlen alak: NEM rövidítünk. Rossz azonosító rosszabb, mint egy hosszú
  // címke, és a rövidítés csak akkor nyer bármit, ha van mit elhagyni.
  if (blocks.length < 3) return assetNumber;

  return blocks.slice(-2).join("-");
}

/**
 * Milliméterből PDF-pont. A PDF pont mérete rögzített: 1/72 hüvelyk, tehát a
 * váltószám nem beállítás kérdése.
 */
export function mmToPoints(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * Amit a `Print.printAsync` és a `printToFileAsync` hívásba kell tenni.
 *
 * Enélkül a lap Letter méretű lesz (az `expo-print` iOS oldalán a
 * `PrintOptions.toPageSize()` a `kLetterPaperSize = 612 x 792` pontból indul, és
 * csak a hívás `width`/`height` értékét veszi figyelembe; a `@page` CSS-t ez az
 * út nem olvassa) -- nem hibaüzenettel, hanem egy használhatatlan PDF-fel, ami
 * első ránézésre rendben van.
 */
export function labelPageSize(): { width: number; height: number } {
  const layout = labelLayout();
  return {
    width: mmToPoints(layout.pageWidthMm),
    height: mmToPoints(layout.pageHeightMm),
  };
}
