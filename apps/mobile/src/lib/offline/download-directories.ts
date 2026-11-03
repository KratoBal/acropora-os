/**
 * A TELEFON GYORSÍTÓTÁRÁBA LETÖLTÖTT FÁJLOK KÖNYVTÁRAI, EGY HELYEN (barracuda kérdése a #2086-on, 2026-11-03: a számla PDF-je
 * kijelentkezés után a telefonon maradt). Minden letöltő innen veszi a könyvtára nevét, és a kijelentkezés
 * (`forget-downloaded-files.ts`) mindet törli; egy új letöltési könyvtár, ami nem itt áll, a
 * `download-directories.spec.ts` őrzőn bukik el.
 *
 * Tiszta fájl, natív modul nélkül, hogy a node-tesztek olvashassák.
 */
export const DOWNLOAD_DIRECTORIES = {
  /** Az Üzenetek csatolmányai és a számlák PDF-je (`messages/native-files.ts`). */
  attachments: "uzenet-csatolmanyok",
  /** A dokumentum-képek és bélyegképek, a helyszíni offline letöltőé is (`documents/kep-fajl-deps.ts`). */
  documentImages: "dokumentum-kepek",
} as const;
