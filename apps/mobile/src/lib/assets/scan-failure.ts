/**
 * What to say when resolving a scanned QR code did not work.
 *
 * The screen used to say one thing for every failure: "A QR-kód nem
 * azonosítható". With no signal that is a false statement - the code is
 * fine, the server simply could not be reached - and it sends a technician
 * standing in a basement to replace a sticker that was never broken.
 *
 * The client already tells the two apart: `ApiNetworkError` means the
 * request never arrived, `ApiError` means the server answered. Nothing new
 * has to be detected here; the distinction just has to survive as far as
 * the screen.
 */
export interface ScanFailure {
  title: string;
  message: string;
  /**
   * Whether trying the same thing again could work. Reaching the server
   * again might; asking it about a token it does not know will not.
   */
  canRetry: boolean;
}

/**
 * Duck-typed rather than importing the error classes, so this module stays
 * free of the fetch layer and can be exercised with plain `node --test` -
 * the same arrangement the auth logic uses.
 */
function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

export interface ScanFailureContext {
  /**
   * Megnéztük-e a készüléken tárolt helyszíni másolatot is, és nem találtuk
   * benne a kódot. Enélkül a "nincs kapcsolat" üzenet azt sugallja, hogy térerő
   * mellett minden rendben lenne -- pedig ez az eszköz a mentett listán sincs
   * rajta, tehát vagy új, vagy nem szinkronizált még erre a készülékre.
   */
  searchedOfflineCopy?: boolean;
}

export function describeScanFailure(
  error: unknown,
  context: ScanFailureContext = {},
): ScanFailure {
  if (errorName(error) === "ApiNetworkError") {
    if (context.searchedOfflineCopy)
      return {
        title: "Nincs kapcsolat, és nincs mentve ez az eszköz",
        message:
          "A szervert nem érjük el, a készüléken mentett listán pedig nincs rajta ez a kód. Térerőnél próbáld újra: ha az eszköz létezik, onnantól offline is megvan.",
        canRetry: true,
      };

    return {
      title: "Nincs kapcsolat a szerverrel",
      message:
        "A QR-kóddal nincs baj, csak nem érjük el a szervert. Ha van térerő, próbáld újra.",
      canRetry: true,
    };
  }

  return {
    title: "A QR-kód nem azonosítható",
    message:
      "A szerver nem ismeri ezt a kódot. Lehet, hogy lecserélték, vagy nem Acropora OS eszközazonosító.",
    canRetry: false,
  };
}
