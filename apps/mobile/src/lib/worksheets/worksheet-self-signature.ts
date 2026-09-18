/**
 * A SAJÁT KOLLÉGÁNK ALÁÍRÁSA A TELEFONON: A BIOMETRIKUS KAPU DÖNTÉSE.
 *
 * Balázs kérése, 2026-09-18 07:01 UTC: „Es az elozo kepernyon utolso gomb
 * Alairom. itt jo lenne ha valami biometrikus azonositas tortenne"
 *
 * === MIT ÁLLÍT A BIOMETRIA, ÉS MIT NEM ===
 *
 * A készülék tulajdonosát azonosítja, NEM a szerver felé bizonyít. Helyi,
 * kényelmi kapu; a bizonyító erőt a munkamenet hordozza, ami a lapot amúgy is
 * lezárja és a tételeit átírja.
 *
 * EBBŐL KÉT KÖVETKEZMÉNY, ÉS MIND A KETTŐ acrobot DÖNTÉSE (2026-09-18 13:22 és
 * 13:23):
 *
 * 1. A KIMENETÉT NEM TÁROLJUK EL BIZONYÍTÉKKÉNT. Egy elmentett „biometriával
 *    aláírva" mező pontosan azt a látszatot keltené, hogy ellenőriztük.
 * 2. AKINEK NINCS BEÁLLÍTVA, AZ NEM ESIK KI A MUNKÁBÓL.
 *
 * === A KÉT NEMLEGES KIMENET NEM UGYANAZ, ÉS EZ A MODUL LÉNYEGE ===
 *
 * A meglévő `biometric-outcome.ts` már szétválasztja őket, és a különbség egy
 * mondat:
 *
 *   „nincs mit próbálni"      a KÉSZÜLÉKRŐL szól -- hiányzó adat
 *   „lefutott, de nem sikerült"  a SZEMÉLYRŐL szól -- nemleges válasz
 *
 * Egy hiányzó adatot nem szabad nemleges válaszként kezelni, sem fordítva. Ezért
 * a beállítatlan készüléken az aláírás MEGY, egy elutasított ujjlenyomat után
 * viszont NEM: ott VAN állításunk, és azt figyelmen kívül hagyni rosszabb, mint
 * meg sem kérdezni.
 *
 * === AMI A PARTNER-ÁGRA NEM IGAZ ===
 *
 * Ott az aláírókód KÖTELEZŐ marad, és a biometria nem helyettesíti. Két
 * különböző kérdés: a kód azt bizonyítja, hogy a PARTNER embere volt ott; ez a
 * kapu azt, hogy a telefon a saját kollégánké.
 */

/** Amit a készülék mondott. Ugyanaz a három érték, mint az app-feloldásnál. */
export type BiometricOutcome = "unlocked" | "rejected" | "unavailable";

export interface SelfSignatureGate {
  /** Mehet-e az aláírás ezzel a kimenettel. */
  mayProceed: boolean;
  /**
   * Felkínálható-e ÚJRA a biometria. Csak akkor, ha van mit próbálni: egy
   * „próbáld újra" gomb egy Face ID nélküli telefonon olyan gomb, ami nem tud
   * működni.
   */
  mayRetry: boolean;
  /** Amit a szerelő lát. `null`, ha nincs mit mondani (sikerült). */
  message: string | null;
}

export function selfSignatureGate(
  outcome: BiometricOutcome,
): SelfSignatureGate {
  switch (outcome) {
    case "unlocked":
      return { mayProceed: true, mayRetry: false, message: null };

    case "unavailable":
      /**
       * HIÁNYZÓ ADAT, NEM NEMLEGES VÁLASZ. A készüléken nincs beállítva
       * biometria (vagy a natív modul elhasalt). Ettől nem eshet ki valaki a
       * munkából: a védelem a munkamenet, és az megvan.
       *
       * A MONDAT KIMONDJA, HOGY NEM TÖRTÉNT AZONOSÍTÁS -- különben a szerelő
       * azt hinné, hogy igen.
       */
      return {
        mayProceed: true,
        mayRetry: false,
        message:
          "Ezen a telefonon nincs beállítva biometrikus azonosítás, ezért az " +
          "aláírás a bejelentkezésed alapján megy.",
      };

    case "rejected":
      /**
       * NEMLEGES VÁLASZ. A készülék azt mondta, hogy nem a tulajdonos -- vagy
       * megszakították. Az ADOTT KÍSÉRLET elutasítva; újra lehet próbálni, de
       * MEGKERÜLŐ ÚT NINCS. Itt van állításunk, és azt figyelmen kívül hagyni
       * rosszabb, mint meg sem kérdezni.
       */
      return {
        mayProceed: false,
        mayRetry: true,
        message:
          "Az azonosítás nem sikerült, ezért az aláírás nem ment el. " +
          "Próbáld újra.",
      };
  }
}
