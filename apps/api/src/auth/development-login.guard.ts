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
 * 2. ALAPÉRTELMEZÉSBEN TILT. A hiányzó érték NEM engedély. Egy éles példány
 *    beállításai közt nincs oka szerepelni, tehát ott a zár magától zárva van.
 *
 * A HIÁNYZÓ ÉRTÉK TILT, ÉS EZ SZÁNDÉKOSAN MÁS, MINT A `NODE_ENV`-NÉL. Ott a
 * beállítatlan érték megengedett, mert a CI és a helyi futás úgy megy, tehát a
 * szigorítás működő környezeteket állítana meg. Itt fordítva: a beállítatlan
 * érték az ÉLES példány állapota, tehát épp azt kell megfognia. A helyi
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
