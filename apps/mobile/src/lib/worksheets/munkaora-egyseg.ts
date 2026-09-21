/**
 * SZÓL-E A LAP, HA A SOR MUNKAÓRA, DE AZ EGYSÉGE NEM ÓRA -- A TELEFONON.
 *
 * === UGYANAZ A SZABÁLY, MINT A WEBEN, ÉS MÉGIS KÉT PÉLDÁNY ===
 *
 * A webes oldal a `@acropora/types` `munkaoraEgysegFigyelmeztetes`
 * függvényét hívja. Ez a csomag NEM tud onnan importálni: az `apps/mobile`
 * szándékosan kívül esik a pnpm munkatéren, és saját, kézzel írt típusokat
 * tart. Ugyanez az ok, amiért a mennyiség-olvasónak (`parseQuantity`) is saját
 * alakja van itt.
 *
 * AMI A KÉT MÁSOLAT ELCSÚSZÁSA ELLEN VÉD: mind a két oldalon UGYANAZ a két
 * irány van megmérve (`db` mellett szól, `óra` mellett nem). Ha az egyik
 * elmozdul, az PIROS lesz, nem néma.
 *
 * === A BEJELENTÉS (Balázs, 2026-09-21 12:51:56 UTC) ===
 *
 * Egy anyag-sor munkaóraként került fel, és az összesítőbe két óra került egy
 * fél óra munkából. A számolás jól számolt: a `kind` dönti el, mi a munkaóra.
 * Az új sor alapértelmezésben munkaóra, és az anyagnál ki kell kapcsolni.
 *
 * AZ ALAPÉRTELMEZÉS NEM VÁLTOZIK (Balázs elfogadta, 13:01:03): ha egy anyag
 * bent marad munkaóraként, az összeg túl magas, és OTT A SOR, ami okozza. Ha
 * egy munka kimarad, az összeg túl alacsony, és semmi nyom. A hangosabb
 * tévedést tartjuk meg, csak mostantól a lap KIMONDJA az ellentmondást.
 *
 * ÉS NEM TILTJA A MENTÉST: terelés, nem zár.
 */

const ORA_ALAKOK = new Set(["ora", "h", "hour", "munkaora"]);

function egyszerusit(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function munkaoraEgysegFigyelmeztetes(input: {
  kind: string;
  unit: string;
}): string | null {
  if (input.kind !== "LABOR") return null;
  /*
    AZ ÜRES EGYSÉG NEM SZÓL: a sor akkor is üres, amikor a kolléga még csak
    most kezdi kitölteni.
  */
  const egyseg = egyszerusit(input.unit);
  if (!egyseg) return null;
  if (ORA_ALAKOK.has(egyseg)) return null;

  return `Ez a sor munkaóraként számít bele az összesítésbe, de a mértékegysége „${input.unit.trim()}". Ha anyag, kapcsold ki a munkaóra jelölést.`;
}
