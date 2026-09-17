/**
 * KAP-E A KÉRÉS TÖRZSE JSON FEJLÉCET.
 *
 * Külön áll a `client.ts`-től, hogy `fetch`, SecureStore és `@/config/env`
 * nélkül forduljon - ugyanabból az okból, amiért a `request-auth.ts` is külön
 * fájl. A teszt-fordítás `lib: ["ES2022"]` mellett megy, tehát DOM-típus (mint
 * a `BodyInit` vagy a `FormData`) itt nem hivatkozható, és nem is kell: a
 * döntéshez elég annyi, hogy a törzs szöveg-e.
 *
 * A SZÖVEGES TÖRZS KAP. Enélkül a `fetch` `text/plain` néven küldi, az API
 * JSON-értelmezője békén hagyja, és a kérés ÜRES törzzsel érkezik meg - minden
 * mező egyszerre bukik el a validáción, pontosan úgy, mintha az űrlapot üresen
 * küldték volna be.
 *
 * A FORMDATA NEM KAP. A többrészes törzs a saját `boundary` értékét viszi, és
 * egy kézzel beírt `application/json` mellett a szerver az egész törzset egyetlen
 * értelmezhetetlen blokknak látná: a kérés megérkezne, a fájl nélkül. A hiba
 * CSENDES -- a hívás nem dob, a válasz egy sima elutasítás, és a telefonon úgy
 * néz ki, mintha magával a fájllal lenne baj.
 *
 * === ÉS A MAI FUTTATÓ EGY RÉTEGGEL MEGVÉD -- DE EZ NEM OK A LAZÍTÁSRA ===
 *
 * Mérve (nautilus, 2026-09-17, Expo 57.0.11): a futtató globális `fetch`-e a
 * `FormData` törzsnél FELÜLÍRJA a Content-Type fejlécet a saját boundary-jával.
 * A két sor, ahonnan ez jön:
 *
 *     // expo/src/winter/fetch/RequestUtils.ts
 *     overriddenHeaders: [['Content-Type', `multipart/form-data; boundary=...`]]
 *     // expo/src/winter/fetch/fetch.ts
 *     headers = overrideHeaders(headers, overriddenHeaders);
 *
 * Vagyis MA egy tévesen beírt `application/json` nem okozna kárt: a futtató
 * eldobná. Ezt ki kell mondani, mert enélkül ez a döntés ERŐSEBB védelemnek
 * látszik, mint amilyen -- és egy megjegyzés, ami többet ígér a valóságnál,
 * rosszabb a semminél.
 *
 * AMIÉRT A DÖNTÉS MÉGIS MARAD: a felülírás a FUTTATÓ választásán múlik, nem a
 * miénken. Az `expo/src/winter/runtime.native.ts` végén ott az
 * `EXPO_PUBLIC_USE_RN_FETCH` kapcsoló, ami visszaadja a React Native saját
 * `fetch`-ét -- és az nem ír felül semmit. Egy ilyen váltás egyetlen sor, és
 * ettől a ma ártalmatlan hiba némán élessé válna.
 *
 * A webes kliens ugyanezt a különbséget már megteszi (`jsonContentType`),
 * ugyanabból az okból.
 */
export function needsJsonContentType(body: unknown): boolean {
  return typeof body === "string";
}
