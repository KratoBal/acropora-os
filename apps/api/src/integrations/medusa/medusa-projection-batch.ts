/**
 * A VETITES KOTEGELESE: MIT KER A HIVO, ES MI TORTENIK, HA ELLENTMOND MAGANAK.
 *
 * MIERT KULON MODUL: a parancs torzse a `prisma`-t modul-szintu importbol veszi,
 * tehat teszt-duplat nem lehet neki adni -- a fajl mar ma is ezt dokumentalja a
 * hiany-sorok kapcsan. Az ARGUMENTUM-ERTELMEZES viszont tiszta fuggveny, es
 * pontosan az a resz, ahol egy elgepeles CSENDBEN mast futtatna, mint amit a
 * hivo akart.
 *
 * MIERT KELL EGYALTALAN: a parancs ma KOTELEZOEN ker legalabb egy
 * termekazonositot, es nincs koteg-kapcsoloja. Egy "par tucat termek" adaghoz ma
 * kezzel kellene felsorolni oket, a teljes katalogushoz (1893 termek) pedig
 * semmilyen alakban nem megy.
 */

export interface BatchSelection {
  /** Kezzel felsorolt azonositok. Ures, ha a hivo kotegelest kert. */
  targets: string[];
  /** Hany termek menjen egy menetben. `null`, ha nincs korlat. */
  limit: number | null;
  /** Ettol az azonositotol (KIZAROLAG utana), stabil rendezes szerint. */
  from: string | null;
  forgetOnly: boolean;
}

export type BatchParseResult =
  | { kind: "ok"; selection: BatchSelection }
  | { kind: "error"; message: string };

const LIMIT = "--limit";
const FROM = "--from";
const FORGET = "--forget-link";

/**
 * AZ ERTELMEZES, ES A HAROM ELLENTMONDAS, AMI HIBAT AD.
 *
 * MIERT HIBA ES NEM "ESZSZERU ERTELMEZES": egy parancs, ami ellentmondo
 * kapcsolokbol kitalal valamit, PONTOSAN azt teszi, amitol a kotegeles
 * veszelyes -- mast futtat, mint amit a hivo hitt. Az elso adagnal ez meg
 * atlathato; a teljes katalogusnal egy felreertett `--from` szaz termeket
 * hagyna ki csendben.
 */
export function parseBatchArguments(args: string[]): BatchParseResult {
  const selection: BatchSelection = {
    targets: [],
    limit: null,
    from: null,
    forgetOnly: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === FORGET) {
      selection.forgetOnly = true;
      continue;
    }

    if (arg === LIMIT || arg === FROM) {
      const value = args[index + 1];
      /**
       * A HIANYZO ERTEK KULON HIBA, es nem "vegyuk nullanak". Egy
       * `--limit` ertek nelkul a sor VEGEN all: ott a kovetkezo argumentum
       * `undefined`, es egy elnezo ertelmezes NULLA termeket futtatna --
       * sikeresen, nulla sorral, es a hivo azt hinne, nincs mit vinni.
       */
      if (value === undefined)
        return { kind: "error", message: `A(z) ${arg} után érték kell.` };
      /**
       * ES HA A KOVETKEZO ARGUMENTUM EGY MASIK KAPCSOLO, az sem ertek. Enelkul
       * a `--limit --from prod_x` alakban a limit erteke a "--from" SZOVEG
       * lenne, a `--from` pedig elveszne.
       */
      if (value.startsWith("--"))
        return {
          kind: "error",
          message: `A(z) ${arg} után érték kell, nem egy másik kapcsoló (${value}).`,
        };

      if (arg === FROM) selection.from = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1)
          return {
            kind: "error",
            message: `A(z) ${LIMIT} értéke legyen 1-nél nem kisebb egész szám (${value}).`,
          };
        selection.limit = parsed;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--"))
      return { kind: "error", message: `Ismeretlen kapcsoló: ${arg}` };

    selection.targets.push(arg);
  }

  /**
   * A KEZZEL FELSOROLT AZONOSITO ES A KOTEGELES EGYUTT ELLENTMONDAS.
   *
   * Ha a hivo megnevez harom terméket ES kér egy `--limit 20`-at, akkor vagy a
   * harmat akarja, vagy husz mast. Egy "eszszeru" valasztas (mondjuk a
   * felsoroltakat) azt jelentene, hogy a `--limit` csendben nem csinal semmit
   * -- es a kovetkezo hivo mar arra epitene.
   */
  if (selection.targets.length && (selection.limit !== null || selection.from))
    return {
      kind: "error",
      message:
        `Vagy termékazonosítókat sorolj fel, vagy kérj köteget ` +
        `(${LIMIT} / ${FROM}), a kettő együtt nem megy.`,
    };

  if (!selection.targets.length && selection.limit === null && !selection.from)
    return {
      kind: "error",
      message:
        `Adj meg legalább egy termékazonosítót vagy sku: alakot, ` +
        `vagy kérj köteget a ${LIMIT} kapcsolóval.`,
    };

  /**
   * A `--from` ONMAGABAN KORLAT NELKUL A TELJES MARADEKOT VINNE. Ez ma 1893
   * termeket jelenthet, es egy elso adaghoz nem az kell. A `--limit` ezert
   * kotelezo mellette -- ha valaki tenyleg mindent akar, azt KIMONDVA kerje egy
   * nagy limittel, ne egy elhagyott kapcsoloval.
   */
  if (selection.from && selection.limit === null)
    return {
      kind: "error",
      message: `A(z) ${FROM} mellé ${LIMIT} is kell: enélkül a teljes maradék indulna.`,
    };

  return { kind: "ok", selection };
}
