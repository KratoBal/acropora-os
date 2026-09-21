/**
 * SZÓL-E A LAP, HA A SOR MUNKAÓRA, DE AZ EGYSÉGE NEM ÓRA.
 *
 * === A BEJELENTÉS (Balázs, 2026-09-21 12:51:56 UTC, Discord) ===
 *
 * „ha pl beirja, hogy munkaora 0,5 2 fo es egy tetel mondjuk egy beepitett
 * eszkoz 1 db akkor a vegen osszeadja: pelda 0,5 ora 2 fo elso tetelsor.
 * masodik tetelsor csapagycsere 1db akkor az osszesenbe 2 ora kerul"
 *
 * === EZ NEM ÖSSZEADÁSI HIBA ===
 *
 * A számolás jól számolt: a `kind` dönti el, mi a munkaóra, és a csapágy sora
 * MUNKAÓRAKÉNT került fel. 0,5 óra x 2 fő = 1, plusz 1 db x 1 fő = 1.
 *
 * Az ok az, hogy az új tételsor ALAPÉRTELMEZÉSBEN munkaóra, és az anyag-sornál
 * ki kell venni a jelölést.
 *
 * === AZ ALAPÉRTELMEZÉS NEM VÁLTOZIK, ÉS EZ TUDATOS ===
 *
 * A két tévedés ára nem egyforma. Ha egy anyag bent marad munkaóraként, az
 * összeg TÚL MAGAS, és OTT A SOR, ami okozza -- látható. Ha egy munka kimarad,
 * az összeg TÚL ALACSONY, és a hiányzó óra semmi nyomot nem hagy. A hangosabb
 * tévedést választottuk, és Balázs ezt elfogadta (2026-09-21 13:01:03: „jo
 * igy"). Amit változtatunk: a lap MONDJA KI az ellentmondást.
 *
 * === MIÉRT HASZNÁLHATJA EZ A SZÖVEGET, HOLOTT AZ ÖSSZEGZÉS NEM ===
 *
 * Az összegzés a `kind` mezőn áll, és ott is marad: egy elgépelt „ora", egy
 * nagy kezdőbetűs „Óra" vagy egy „munkaora" CSENDBEN kimaradna az összegből.
 *
 * A FIGYELMEZTETÉSNÉL a tévedés ára NULLA: egy fölösleges figyelmeztetés
 * bosszantó, egy hiányzó óra nem látszik. Ezért itt a szöveg is használható --
 * és ezért NEM tiltja a mentést: terelés, nem zár.
 */

/**
 * AMIT ÓRÁNAK FOGADUNK EL. Kisbetűsítve és ékezet nélkül hasonlítunk, mert a
 * mező szabad szöveg: az „Óra", az „ORA" és az „óra" ugyanaz a szándék.
 */
const ORA_ALAKOK = new Set(["ora", "h", "hour", "munkaora"]);

function egyszerusit(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function munkaoraEgysegFigyelmeztetes(input: {
  /** A sor fajtája, ahogy az összegzés is látja. */
  kind: string;
  /** A szabad szöveges mértékegység, ahogy a kolléga beírta. */
  unit: string;
}): string | null {
  if (input.kind !== "LABOR") return null;

  /*
    AZ ÜRES EGYSÉG NEM SZÓL. A sor akkor is üres, amikor a kolléga még csak
    most kezdi kitölteni -- egy figyelmeztetés gépelés közben arra, amit épp
    javítani készül, ugyanaz a hiba, ami miatt a számmá alakítás is csak a
    beküldéskor történik. Az üres egységet amúgy is a szerver utasítja el.
  */
  const egyseg = egyszerusit(input.unit);
  if (!egyseg) return null;
  if (ORA_ALAKOK.has(egyseg)) return null;

  return `Ez a sor munkaóraként számít bele az összesítésbe, de a mértékegysége „${input.unit.trim()}". Ha anyag, vedd ki a munkaóra jelölést.`;
}
