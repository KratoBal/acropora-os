import { Directory, Paths } from "expo-file-system";

import { DOWNLOAD_DIRECTORIES } from "./download-directories";

/**
 * KIJELENTKEZÉSKOR A LETÖLTÖTT FÁJLOK IS MENNEK (barracuda, #2086): egy számla PDF-je vagy egy partner eszközének fényképe egy
 * átadott telefonon nem élheti túl a munkamenetet, amiben letöltötték. Helyi művelet, tehát akkor is lefut, ha a kijelentkezési
 * kérés nem ért el a szerverig (`sign-out.ts`). Egy könyvtár hibája nem állítja meg a többit és a kijelentkezést sem; a hibát
 * kiírja, hogy ne legyen néma.
 */
export async function forgetDownloadedFiles(): Promise<void> {
  for (const name of Object.values(DOWNLOAD_DIRECTORIES)) {
    try {
      const directory = new Directory(Paths.cache, name);
      if (directory.exists) directory.delete();
    } catch (error) {
      console.warn(`A letöltött fájlok könyvtára nem törölhető: ${name}`, error);
    }
  }
}
