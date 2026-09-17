import { useQuery } from "@tanstack/react-query";

import { environment } from "@/config/env";
import { authSessionStore } from "@/lib/auth/token-store";

import { documentImageSource } from "./document-view";

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
  return (documentId: string) =>
    ownerPath && apiUrl && ertek
      ? documentImageSource({ apiUrl, token: ertek, ownerPath, documentId })
      : null;
}
