/**
 * Az EGYETLEN token-rekord, amit a gépi tartalom-bejárat elfogad.
 *
 * A HÁZIREND, AMIT KÖVET, ÉS AMI KÉTSZER LE VAN ÍRVA A REPÓBAN: az
 * `AiProductSearchGuard` és az `AiUserContextGuard` fejléce egyaránt kimondja,
 * hogy egy MÁSODIK használati esetnek saját mechanizmust kell nyitnia, ahelyett
 * hogy a meglévőt szélesítenénk. Ez a harmadik ilyen mechanizmus.
 *
 * Ezért nem a globális `AuthGuard` tanult meg szolgáltatás-tokent olvasni. Ha
 * egyszer minden végpont elfogadna egyet, a hatókör onnantól a token jogain
 * múlna, nem az őrzőn -- és a későbbi szűkítés már nem kód-kérdés lenne, hanem
 * bizalom-kérdés.
 *
 * A KÖRNYEZETET PARAMÉTERKÉNT veszi, nem importáláskor olvassa: a
 * "beállítatlan engedélylista mindent elutasít" tulajdonságot csak így lehet
 * teszttel bizonyítani. Egy importáláskor beégetett értéket a teszt már nem tud
 * megváltoztatni, tehát a beállítatlan eset nem is állítható elő.
 */
export const CONTENT_AGENT_TOKEN_IDS_ENV = "ACROPORA_CONTENT_AGENT_TOKEN_IDS";

/**
 * Injektálási kulcs a környezethez.
 *
 * A Nest a konstruktor-paramétereket a kiírt típusuk szerint oldja fel, és a
 * `NodeJS.ProcessEnv` `Object`-re törlődik, ami nem szolgáltató. Egy
 * alapértelmezett paraméter-érték nem ment meg: a konténer már azelőtt elhasal,
 * hogy odáig jutna, és az egész API nem indul el. Pontosan ez az alak állította
 * meg az `AiUserContextGuard`-ot, amikor először megírták.
 */
export const CONTENT_AGENT_ENVIRONMENT = Symbol("CONTENT_AGENT_ENVIRONMENT");

/**
 * A megengedett token-azonosítók, vesszővel elválasztva.
 *
 * TÖBBES SZÁMBAN, a két AI-őrzővel szemben, és ennek mért oka van: Balázs
 * döntése szerint MINDEN ÁGENS SAJÁT FIÓKOT kap, tehát saját tokent is. Egy
 * egyértékű beállítás itt azt jelentené, hogy vagy egy ágens ír, vagy minden
 * ágens ugyanabból a fiókból -- és a második pontosan az, amit a döntés
 * elkerülni akart.
 *
 * ÜRES VAGY HIÁNYZÓ ÉRTÉK MINDENT ELUTASÍT. Fordítva írva ez lenne a fájl
 * legveszélyesebb sora: egy üres lista "nincs korlátozás" jelentéssel egy
 * elfelejtett környezeti változót nyitott ajtóvá tenne, és a válaszban semmi
 * nem mutatná.
 */
export const contentAgentTokenIds = (
  environment: NodeJS.ProcessEnv,
): string[] =>
  (environment[CONTENT_AGENT_TOKEN_IDS_ENV] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
