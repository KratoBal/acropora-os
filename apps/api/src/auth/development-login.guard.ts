/**
 * A MÁSODIK ZÁR A FEJLESZTŐI BEJELENTKEZÉSEN.
 *
 * MIÉRT KELL, HA MÁR VAN EGY. A `node-env.guard.ts` az ISMERETLEN `NODE_ENV`
 * értéket fogja meg. A `development` viszont ISMERT érték: ha valaki azt
 * állítja be az éles példányon (elgépelésből, másolt beállításból vagy egy
 * rosszul átvett környezeti fájlból), az az őrző ÁTENGEDI, és a fejlesztői
 * bejelentkezés nyitva áll. Az első őrző a hibás ÉRTÉKET fogja meg, ez a
 * második a hibás KÖVETKEZMÉNYT.
 *
 * EZÉRT NEM A `NODE_ENV`-RE ÉPÜL. Két zár, ami ugyanarra az egy értékre
 * támaszkodik, nem két zár, hanem ugyanaz a zár kétszer. A mérce, aminek
 * teljesülnie kell: legyen olyan bemenet, amitől az ELSŐ őrző átenged és ez
 * MEGÁLL. Van ilyen, és a tesztje is megvan:
 *
 *     NODE_ENV=development   (ismert érték, az első őrző elengedi)
 *     AUTH_PROVIDER          nincs beállítva
 *     -> a fejlesztői bejelentkezés NEM működik
 *
 * MIÉRT ÉPP AZ `AUTH_PROVIDER`. Már létezik: a `.env.example` deklarálja
 * (`AUTH_PROVIDER=development`), és eddig a kód SEHOL nem olvasta -- egy
 * dokumentált, de halott változó volt. Két tulajdonsága teszi alkalmassá:
 *
 * 1. NEM ÁLTALÁNOS. A `NODE_ENV` pont azért veszélyes, mert minden sablonban
 *    ott van, és minden környezeti fájl másolásakor utazik. Egy erre az egy
 *    célra elnevezett változót nem másol be senki véletlenül.
 * 2. ALAPÉRTELMEZÉSBEN TILT. A hiányzó érték NEM engedély, tehát ahol a változó
 *    nincs beállítva, ott a zár magától zárva van.
 *
 * A MÁSODIK PONT HATÓKÖRE SZŰKEBB, MINT AHOGY ELŐSZÖR LEÍRTAM, ÉS EZ MÉRÉSI
 * HIBA VOLT, NEM FOGALMAZÁSI. Azt írtam ide, hogy „egyik `Dockerfile` sem
 * állítja be, tehát az éles képen külön lépés nélkül zárva van". A
 * `Dockerfile`-okra ez igaz és ma is áll. De az állítás a KÉPRŐL szól, nem a
 * FUTÓ PÉLDÁNYRÓL: a Coolify a recepten KÍVÜL is ad át környezeti változókat, és
 * a termelési beállítások közt az `acropora-api` alkalmazáson az `AUTH_PROVIDER`
 * SZEREPEL, kétszer (acrobot mérése, 2026-08-31). Az értéke onnan nem
 * olvasható ki, azt a konténerben kell megnézni.
 *
 * AMIÉRT EZT IDE ÍRJUK, ÉS NEM CSAK JAVÍTJUK: a `Dockerfile`-ok átnézése NEM
 * TUDOTT VOLNA Coolify-változót találni. A nulla találat tehát a kérdés
 * tulajdonsága volt, nem a világé -- és pont ettől látszott ténynek. Aki
 * legközelebb azt akarja tudni, hogy egy változó be van-e állítva egy futó
 * példányon, a PÉLDÁNYT mérje (`printenv`), ne a receptet.
 *
 * MA EBBŐL NINCS KÁR, és ezt is ki kell mondani, hogy ne tűnjön nagyobbnak: az
 * élesen `NODE_ENV=production`, amit ez a függvény szintén néz, tehát ott az
 * ajtó két okból is zárva van. A lelet a FELTEVÉSRŐL szól, nem a mai állapotról.
 *
 * A HIÁNYZÓ ÉRTÉK TILT, ÉS EZ SZÁNDÉKOSAN MÁS, MINT A `NODE_ENV`-NÉL. Ott a
 * beállítatlan érték megengedett, mert a CI és a helyi futás úgy megy, tehát a
 * szigorítás működő környezeteket állítana meg. Itt fordítva: a beállítatlan
 * érték az ÉLES példány várt állapota, tehát épp azt kell megfognia. A helyi
 * fejlesztést ez nem érinti, mert a `.env.example` már tartalmazza a sort.
 */

/**
 * `null`, ha a fejlesztői bejelentkezés engedélyezett; különben a MEGTAGADÁS
 * OKA, diagnosztikának.
 *
 * AZ OK A NAPLÓBA MEGY, NEM A VÁLASZBA. A hívó egy nem hitelesített kérés, és
 * egy olyan üzenet, ami megnevezi a hiányzó változót, pontosan azt mondaná meg
 * egy támadónak, mit keressen. A `node-env.guard.ts` üzenete azért nevezheti
 * meg a kárt, mert az az indulási naplóba megy, és üzemeltető olvassa.
 */
export function developmentLoginRefusal(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const provider = env.AUTH_PROVIDER?.trim() ?? "";
  if (provider !== "development") {
    return provider === ""
      ? "az AUTH_PROVIDER nincs beállítva, tehát ez a példány nem a development auth adaptert futtatja"
      : `az AUTH_PROVIDER értéke "${provider}", nem "development"`;
  }

  // AZ ELSŐ ZÁR, VÁLTOZATLANUL. Nem ez a másodikat helyettesíti, hanem
  // fordítva: ez önmagában átengedne egy `development` értéket az élesen.
  if (env.NODE_ENV === "production") {
    return "a NODE_ENV értéke production";
  }

  return null;
}
