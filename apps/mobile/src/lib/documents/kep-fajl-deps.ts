import { Directory, File, Paths } from "expo-file-system";

import { authSessionStore } from "@/lib/auth/token-store";

import type { KepLetoltesFuggosegek } from "./document-image-file";

/**
 * A KEP-LETOLTES FUTASIDEJU VARRATAI, EGY HELYEN.
 *
 * === MIERT KULON MODUL (2026-09-21) ===
 *
 * Ket hivo van rajuk, es EGYIK SEM merheto: a kepernyo horga
 * (`use-document-image-file.ts`) es a helyszin-letolto, ami a belyegkepeket
 * ELORE hozza le. Ha mind a ketto sajat masolatot tartana, a ket ut
 * KULONBOZO konyvtarba vagy kulonbozo fajlnevre irna -- es akkor az elore
 * letoltott kep ott allna a lemezen, a csempe meg nem talalna meg.
 *
 * A FAJLNEVET A `documentCacheFileName` adja, a KONYVTARAT ez a modul. A
 * kettonek egyeznie kell, es most mar egy helyen all.
 *
 * A TOKEN A KERES PILLANATABAN olvasodik, nem egy gyorsitotarazott ertekbol:
 * nem azert, mert ma elavulhat, hanem mert egy kesobbi token-forgatas a
 * 401-et CSENDBEN visszahozna.
 */
const KONYVTAR_NEVE = "dokumentum-kepek";

export const kepFajlFuggosegek: KepLetoltesFuggosegek = {
  token: () => authSessionStore.getToken(),
  letolt: async ({ uri, headers, fileName }) => {
    const konyvtar = new Directory(Paths.cache, KONYVTAR_NEVE);
    if (!konyvtar.exists) konyvtar.create({ intermediates: true });
    const cel = new File(konyvtar, fileName);
    const fajl = await File.downloadFileAsync(uri, cel, {
      headers,
      idempotent: true,
    });
    return fajl.uri;
  },
  /*
    A LEMEZEN ALLO MASOLAT. A helyszin-letolto ugyanide es ugyanazzal a
    nevvel hozza le a belyegkepeket, tehat ami ott van, azt ez talalja meg.
  */
  helyiFajl: async (fileName) => {
    const konyvtar = new Directory(Paths.cache, KONYVTAR_NEVE);
    if (!konyvtar.exists) return null;
    const fajl = new File(konyvtar, fileName);
    return fajl.exists ? fajl.uri : null;
  },
};
