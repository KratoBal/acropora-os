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
 * A FORMDATA NEM KAP. A fénykép- és dokumentum-feltöltés a saját `boundary`
 * értékét viszi, amit a futtató maga ír a fejlécbe; egy kézzel beírt
 * `application/json` felülírná, és a szerver az egész törzset egyetlen
 * értelmezhetetlen blokknak látná. A kérés megérkezne, a fájl nélkül.
 *
 * ÉS EZ A HIBA CSENDES: a hívás nem dob, a válasz egy sima elutasítás, és a
 * telefonon úgy néz ki, mintha magával a fájllal lenne baj.
 *
 * A webes kliens ugyanezt a különbséget már megteszi (`jsonContentType`),
 * ugyanabból az okból.
 */
export function needsJsonContentType(body: unknown): boolean {
  return typeof body === "string";
}
