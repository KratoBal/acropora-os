import { useQuery } from "@tanstack/react-query";

import { environment } from "@/config/env";
import { authSessionStore } from "@/lib/auth/token-store";

import {
  documentImageSource,
  type DocumentImageVariant,
} from "./document-view";

/**
 * A HITELESÍTETT KÉP-FORRÁS ELŐÁLLÍTÁSA -- a tárolóhoz kötött fele.
 *
 * A DÖNTÉS NEM ITT VAN, hanem a `document-view.ts`-ben, ahol MÉRHETŐ: ez a
 * horog csak a tokent és a beállított címet SZEREZI MEG. Enélkül az útvonal
 * felépítése a képernyő törzsébe kerülne, ahol ebben a csomagban semmi nem
 * méri.
 *
 * A TOKEN LEKÉRDEZÉS, NEM ÁLLAPOT, és ez szándékos: a `SecureStore` olvasása
 * aszinkron, és a token a munkamenet alatt cserélődhet. A gyorsítótár-kulcs
 * ezért nem hordozza -- egy kulcsba tett token a naplókba és a fejlesztői
 * eszközökbe is bekerülne.
 */
export function useDocumentImageSource(ownerPath: string | null) {
  const token = useQuery({
    queryKey: ["auth-token-for-images"],
    queryFn: () => authSessionStore.getToken(),
    enabled: Boolean(ownerPath),
    staleTime: 60_000,
  });

  const apiUrl = environment.ok ? environment.config.apiUrl : null;
  const ertek = token.data ?? null;

  /**
   * `null`, AMÍG NINCS MINDEN. Egy félig felépített forrás (token nélkül) a
   * szerveren 401-et kapna, a képernyőn pedig ÜRES CSEMPEKÉNT jelenne meg --
   * vagyis pontosan úgy, mint a hiba, amit ez az egész kör javít.
   */
  function forras(documentId: string, variant: DocumentImageVariant) {
    return ownerPath && apiUrl && ertek
      ? documentImageSource({
          apiUrl,
          token: ertek,
          ownerPath,
          documentId,
          variant,
        })
      : null;
  }

  /**
   * KÉT NEVESÍTETT FÜGGVÉNY, NEM EGY ELHAGYHATÓ PARAMÉTER -- ACROBOT DÖNTÉSE
   * (2026-09-18).
   *
   * A MÉRT KOCKÁZAT: mind a három képernyő EBBŐL az egy horogból építi a 104
   * pontos CSEMPÉT ÉS a TELJES KÉPERNYŐS képet is. Egy alapértelmezett érték
   * mellett egy lemaradt hívóhely csendben bélyegképet adna a nagy képnek: nem
   * hibázna, nem állna meg, csak ELMOSÓDNA.
   *
   * A CSEMPE GYORSULÁSA LÁTSZIK, A NAGY KÉP ELMOSÓDÁSA NEM. Ezért a hívóhelynek
   * KI KELL MONDANIA, melyiket kéri, és a név mondja meg, nem egy paraméter,
   * amit el lehet felejteni.
   */
  return {
    /** A csempe képe: a szerver bélyegképe, ha van. */
    csempe: (documentId: string) => forras(documentId, "thumbnail"),
    /** A teljes képernyős nézet: MINDIG az eredeti fájl. */
    teljes: (documentId: string) => forras(documentId, "original"),
  };
}
