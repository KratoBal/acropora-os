/**
 * A METAADAT OSSZEFESULESE: MI A MIENK, ES MI NEM.
 *
 * === MIERT MOST, ES MIERT NEM KESOBB ===
 *
 * A vetites eddig a TELJES metaadat-objektumot kikuldte, kizarolag a sajat
 * kulcsaival, es a cel oldalon a mezo CSERE-szemantikaju. Vagyis minden
 * kulcs, amit valaki a Medusa feluleten kezzel hozzaadott, egy futassal
 * csendben eltunt. A vedelem, ami eddig allt, KIZAROLAG az "egyaltalan nincs
 * mondanivalonk" esetre szolt: ha egyetlen kulcsunknak volt erteke, az egesz
 * objektum kiment.
 *
 * Ez eddig elviselheto volt (a bolt oldalan alig van adat). A `unique_piece`
 * jelzo bekotese viszont MEGSZUNTETI ezt a mentseget: attol kezdve a WYSIWYG
 * termekeknel MINDIG lesz mondanivalonk, tehat a vedelem soha nem sul el, es a
 * feluliras allandova valik. Ezert kerul ez a modul ugyanabba a korbe.
 *
 * === AZ OSSZEFESULES NEM ELMARADT VOLT, HANEM SZERKEZETILEG LEHETETLEN ===
 *
 * Merve 2026-09-04: a vetites SOHA nem olvasta vissza a cel oldali metaadatot
 * (harom `.metadata` olvasas van a mappaban, mind a harom a sajat
 * `ExternalReference` sorunkon). Nem egy elfelejtett spread hianyzott, hanem
 * egy LEKERDEZES. Aki csak a tunetet latja, spreadet irna, es semmi nem
 * valtozna -- nincs mibol osszefesulni.
 *
 * === A SZABALY, ES AZ ARA, KIMONDVA ===
 *
 * A MI kulcsaink (a lenti elotag-lista) tekinteteben a vetites a GAZDA:
 * ami a mostani futasban nem szerepel, az a cel oldalrol is ELTUNIK. Minden
 * mas kulcs erintetlen marad.
 *
 * Ennek KET kovetkezmenye van, es a masodik nem melleklet:
 *
 *   1. Egy termek, ami KIKERUL a WYSIWYG kategoriabol, elveszti a jelzot --
 *      enelkul a lapjan orokre "Eladva" allna. Ez a szabaly ERTELME.
 *   2. Ha valaki a Medusa feluleten atir egy MI kulcsunkat (peldaul a
 *      `seo_title` erteket), azt a kovetkezo futas visszaallitja. Ez nem
 *      mellekhatas, hanem ugyanannak a dontesnek a masik oldala: ezeknek a
 *      kulcsoknak a gazdaja az OS.
 *
 * Amit ez NEM tesz: nem talalgat. Egy ismeretlen kulcsrol nem dontjuk el, hogy
 * "valoszinuleg a mienk volt" -- ha nem illik az elotagra, marad.
 */

/**
 * A MI KULCSAINK ELOTAGJAI.
 *
 * Elotag-lista es nem teljes kulcs-lista, mert a `seo_` es a `unas_` csoport
 * NOVEKSZIK: minden uj UNAS-mezo ugyanezt az alakot veszi fel. Egy kezzel
 * karbantartott teljes lista eppen az uj kulcsoknal maradna le, es azok
 * IDEGENKENT tulelnenek egy torlest -- vagyis a hiba csendes lenne.
 */
export const OWNED_METADATA_PREFIXES = ["seo_", "unas_"] as const;

/**
 * A MI KULCSAINK, AMIK NEM ILLENEK AZ ELOTAGRA.
 *
 * A `unique_piece` szandekosan elotag nelkuli: nem UNAS-mezo es nem SEO-mezo,
 * hanem a MI dontesunk a kategoria-fabol. Egy `unas_` elotag azt allitana,
 * hogy a forrasbol jon, es a kovetkezo olvaso ott keresne.
 */
export const OWNED_METADATA_KEYS = ["unique_piece"] as const;

/**
 * EGY PONTOSITAS A SZABALY ALAKJAHOZ (acrobot, 2026-09-07 este).
 *
 * A dontes ugy hangzott el, hogy "harom ELOTAG a mienk". Ketto elotag (`seo_`,
 * `unas_`), a `unique_piece` viszont TELJES KULCS, nem elotag -- es a kulonbseg
 * nem szormenszalhasogatas: elotagkent olvasva egy `unique_piece_valami` nevu
 * uj kulcs a mienknek LATSZANA, holott az `isOwnedMetadataKey` idegennek venne.
 *
 * A ket lista ezert kulon all, es az orzo (a szolgaltatas specjeben) a
 * FUGGVENYT hivja, nem a nevek listajat olvassa -- igy a szabaly egy helyen lakik.
 */

/** A MIENK-E EZ A KULCS. Minden mas erintetlen marad. */
export function isOwnedMetadataKey(key: string): boolean {
  return (
    OWNED_METADATA_KEYS.includes(key as (typeof OWNED_METADATA_KEYS)[number]) ||
    OWNED_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * A CEL OLDALI METAADAT, AHOGY A MEDUSA VISSZAADJA.
 *
 * `unknown` ertek, mert a Medusa metaadat-mezoje nem csak szoveget tarthat, es
 * amit nem mi tettunk oda, azt nem is ertelmezzuk -- csak visszairjuk.
 */
export type ExistingMetadata = Record<string, unknown> | null | undefined;

export interface MetadataMergeResult {
  /**
   * A kikuldendo objektum, vagy `null`, ha a mezot EL KELL HAGYNI a torzsbol.
   *
   * A ketto NEM ugyanaz: egy ures objektum kikuldese TOROLNE a cel oldali
   * metaadatot, a mezo elhagyasa viszont valtozatlanul hagyja.
   */
  metadata: Record<string, unknown> | null;
  /** Azok a MI kulcsaink, amiket ez a futas eltavolit a cel oldalrol. */
  removedKeys: string[];
}

/**
 * OSSZEFESULES: az idegen kulcsok maradnak, a mieink a mostani futasbol jonnek.
 *
 * A MEZO ELHAGYASA (`metadata: null`) akkor helyes, ha NINCS mondanivalonk ES
 * a cel oldalon nincs olyan kulcs, amit el kellene vennunk. Ilyenkor barmilyen
 * kikuldott ertek csak kockazat volna, haszon nelkul.
 */
export function mergeProductMetadata(
  existing: ExistingMetadata,
  ours: Record<string, string>,
): MetadataMergeResult {
  const idegen: Record<string, unknown> = {};
  const eltavolitando: string[] = [];

  for (const [kulcs, ertek] of Object.entries(existing ?? {})) {
    if (!isOwnedMetadataKey(kulcs)) {
      idegen[kulcs] = ertek;
      continue;
    }
    if (!(kulcs in ours)) eltavolitando.push(kulcs);
  }

  const vanMondanivalonk = Object.keys(ours).length > 0;
  if (!vanMondanivalonk && eltavolitando.length === 0)
    return { metadata: null, removedKeys: [] };

  return {
    metadata: { ...idegen, ...ours },
    removedKeys: eltavolitando,
  };
}
