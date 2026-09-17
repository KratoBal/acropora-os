/**
 * EGY HELYI FÁJL BÁJTJAI, A FELTÖLTÉSHEZ.
 *
 * === MIÉRT LÉTEZIK EGYÁLTALÁN ===
 *
 * Mert a futtató globális `fetch`-e a többrészes törzset MAGA állítja össze, és
 * a React Native szokásos fájl-alakját (`{uri, name, type}`) NEM ismeri. Az
 * `expo/src/winter/fetch/convertFormData.ts` három alakot fogad el -- szöveget,
 * `Blob`-ot, és olyan objektumot, amiben van `bytes` --, minden mást eldob:
 *
 *     else throw new Error('Unsupported FormDataPart implementation');
 *
 * A fájl saját fejléc-megjegyzése ki is mondja: *"`uri` is not supported for
 * React Native's FormData."* Ez a modul a harmadik alakhoz adja a bájtokat.
 *
 * === MIÉRT DINAMIKUS AZ IMPORT, ÉS EZ NEM STÍLUS ===
 *
 * Hogy a modul BETÖLTÉSE ártalmatlan maradjon Expo futtató nélkül is: így a
 * `document-upload.ts` továbbra is `tsc` + `node --test` alatt mérhető, és csak
 * a tényleges HÍVÁS igényel telefont. Statikus importtal az egész
 * feltöltés-águnk mérhetetlenné válna.
 *
 * === A HATÁRA, KIMONDVA ===
 *
 * A `bytes()` a TELJES fájlt memóriába olvassa. Ez nem ennek a modulnak az ára:
 * a futtató `fetch`-e amúgy is egyetlen `Uint8Array`-be fűzi össze az egész
 * törzset, tehát a memória-igény a mai állapotban is ugyanennyi. Ha valaha
 * streamelt feltöltés kell, az nem itt dől el, hanem az átvitel cseréjében
 * (`expo-file-system` saját `upload()` hívása vagy `XMLHttpRequest`).
 *
 * Ha a fájl nem olvasható, a `bytes()` DOB, a dobás a `fetch`-ből jön vissza, és
 * a hálózati hiba szövege (`network-failure.ts`) kiírja az okát. Nem nyeljük el:
 * egy néma kihagyás pontosan az az állapot volt, amiből ez a hiba származik.
 */

/** Amit a törzs-építő a bájtok olvasásához kér. Tesztben cserélhető. */
export type ReadFileBytes = (uri: string) => Promise<Uint8Array>;

/**
 * A MODUL ALAKJA SAJÁT LEÍRÁSBÓL JÖN, NEM AZ `expo-file-system` TÍPUSAIBÓL --
 * ÉS EZ MÉRÉS, NEM ÓVATOSSÁG.
 *
 * Egy `import("expo-file-system")` a TÍPUSAIT is feloldja, azon át pedig
 * bejön az `expo-modules-core` és a `react-native/types`, ami `declare global`
 * blokkban felülírja a `FormData` típusát a React Native szűkebb alakjára (csak
 * `append` és `getParts`). Mérve: attól a pillanattól a `document-upload.spec.ts`
 * `TS2339: Property 'get' does not exist on type 'FormData'` hibával állt meg --
 * egy MEGLÉVŐ, jó teszt, amit a saját importom tört el.
 *
 * A `require` visszatérési értéke `any`, tehát nem old fel modul-típust. A saját
 * két interfész ettől még végigviszi a típusosságot a hívásig.
 */
interface ExpoFile {
  bytes(): Promise<Uint8Array>;
}

interface ExpoFileSystemModule {
  File: new (uri: string) => ExpoFile;
}

export const readFileBytes: ReadFileBytes = async (uri) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lásd fent:
  // egy típus-feloldó `import()` behúzza a React Native globális típusait, és
  // eltöri a csomag mérhetőségét `node --test` alatt.
  const mod = require("expo-file-system") as ExpoFileSystemModule;
  return new mod.File(uri).bytes();
};
