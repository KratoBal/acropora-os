import type { DocumentKey } from "./document-store.js";

/**
 * A `storageKey` MEZŐ ÉS A TÁROLÓ KULCSA KÖZTI KAPCSOLAT.
 *
 * A kulcs LEVEZETHETŐ a sorból: az `assetId` és a `documentId` úgyis ott áll.
 * A `storageKey` mező ettől függetlenül tárolja is, és ez SZÁNDÉKOSAN
 * redundáns.
 *
 * MIÉRT ÉRDEMES A REDUNDANCIA: a mező azt mondja meg, hogy a tartalom a
 * tárolóban van (ezt a CHECK megkötés is erre alapozza), a levezetés pedig azt,
 * hogy HOL. Ha a kettő eltér, az azt jelenti, hogy a sort más elrendezéssel
 * írták, mint amit ma olvasunk -- és akkor a helyes viselkedés a megállás, nem
 * az, hogy a mai elrendezés szerint keresünk egy fájlt, ami nincs ott. Az
 * utóbbi „a dokumentum nem található" hibát adna, ami egy MÁSIK, ártalmatlanabb
 * helyzetet ír le, és elrejtené a valódi okot.
 *
 * A KANONIKUS ALAK EGY HELYEN ÁLL, mert két út használja (az írás és az
 * olvasás), és a kettő külön romlana el.
 */
export function storageKeyFor(key: DocumentKey): string {
  return `${key.assetId}/${key.documentId}`;
}

export function assertStorageKeyMatches(
  storedKey: string,
  key: DocumentKey,
): void {
  const expected = storageKeyFor(key);
  if (storedKey !== expected) {
    throw new Error(
      `A dokumentum tároló-kulcsa nem a mai elrendezés szerint áll: "${storedKey}" a várt "${expected}" helyett.`,
    );
  }
}
