/**
 * A PORTÁL KÖZÖS KERETE, A MEGOSZTOTT VIZUÁLIS NYELVEN.
 *
 * === MIÉRT A KERET ELŐSZÖR, ÉS NEM A NÉZETEK ===
 *
 * A 071a64d4 mérése döntötte el, nem ízlés. Az eszköz-adatlap átállásakor a
 * kilenc elhagyott osztályból csak KETTŐ volt eldobható: a portál saját
 * osztályai nem a lapokhoz tartoznak, hanem ehhez a kerethez, és hat, hét,
 * illetve két másik lap épül rájuk. Ha a nézeteket írnánk át előbb, a keret
 * alattuk változatlan maradna, és minden nézetet KÉTSZER érintenénk.
 *
 * === ÉS MIÉRT OSZTÁLY-KONSTANS, NEM KOMPONENS -- EZ IS MÉRÉS ===
 *
 * Az első változatom `Panel`, `LapFejlec`, `Cimke` komponenseket adott. Aztán
 * megmértem, MILYEN ELEMEKEN áll ma a `.panel`:
 *
 *     section 7   article 3   aside 2   form 4   div 1
 *
 * Egy komponens, ami `<div>`-et (vagy `Card`-ot) renderel, TIZENHÉTBŐL
 * TIZENHAT helyen megváltoztatná az elem típusát. A hívóhelyek szándékosan
 * szemantikus elemeket használnak -- egy `<form className="form panel">`-ből
 * nem lehet `<div>`, mert akkor nem űrlap.
 *
 * A kikötés az volt, hogy a keret TARTALMA ne változzon. Az elem típusa a
 * tartalom része, nem a megjelenésé -- tehát a komponens-alak itt nem
 * egyszerűsítés lett volna, hanem néma szemantikai változás.
 *
 * Ezért a keret ITT osztály-konstansként áll: a stílus EGY helyen van
 * (nem másolat, ahogy a kikötés kéri), az elemet pedig a hívóhely választja.
 *
 * === A MÉRETEK A RÉGI STÍLUSLAPBÓL JÖNNEK, BETŰRE ===
 *
 * A `0.85rem` sarok, az `1.4rem` belső tér, a `#e2e2ea` keret: pontosan az,
 * ami a `globals.css`-ben állt, nem a legközelebbi Tailwind-lépcső. Egy
 * „kerekítés" elrendezési eltérést adna, és az megkülönböztethetetlen lenne
 * egy valódi hibától.
 */

/** A panel: fehér lap, vékony kerettel. A `.panel` szabály helyén áll. */
export const PANEL =
  "rounded-[0.85rem] border border-[#e2e2ea] bg-white p-[1.4rem]";

/** A panel címe. A `.panel h2` szabály helyén áll. */
export const PANEL_CIM = "m-0 mb-4 text-[1.1rem]";

/** A panelen belüli adatlista. A `.panel dl` szabály helyén áll. */
export const ADATLISTA =
  "mt-[1.2rem] grid grid-cols-2 gap-4 border-t border-[#eeeef2] pt-4 max-[680px]:grid-cols-1";

/** Az adatlista címkéje és értéke. A `.panel dt` és `.panel dd` helyén. */
export const ADAT_CIMKE = "mb-[0.25rem] text-[0.78rem] text-[#696979]";
export const ADAT_ERTEK = "m-0";

/** A lap fejléce. A `.page-header` szabály helyén áll. */
/*
  A RESZPONZIV VISELKEDES IS A KERET RESZE, ES EZ NEM DISZITES.

  A regi stiluslap 680 pixel alatt oszlopba forditotta a fejlecet es egy
  oszlopra a panel adatlistajat. Ha ezek a szabalyok az osztalyokkal egyutt
  elkerulnenek, a lap SZELES kepernyon valtozatlan maradna, es CSAK telefonon
  romlana el -- vagyis a hiba pont ott jelenne meg, ahol a partner nezi, es
  sehol, ahol mi.
*/
export const LAP_FEJLEC =
  "mb-[1.8rem] flex items-start justify-between gap-6 max-[680px]:flex-col max-[680px]:items-stretch max-[680px]:gap-4";
export const LAP_CIM =
  "mt-[0.15rem] mb-[0.55rem] text-[clamp(1.8rem,3vw,2.5rem)] tracking-[-0.03em]";
export const LAP_LEIRAS = "m-0 max-w-[43rem] leading-[1.55] text-[#616173]";

/** A kis nagybetűs címke a cím fölött. A `.eyebrow` szabály helyén áll. */
export const CIMKE =
  "m-0 text-[0.72rem] font-extrabold tracking-[0.11em] text-[#67539c] uppercase";

/** A visszafelé vezető út. A `.back-link` szabály helyén áll. */
export const VISSZA_LINK =
  "mb-4 inline-block font-bold text-[#4c397f] no-underline";

/*
  AZ ALLAPOT-CIMKE KONSTANSA (`ALLAPOT_CIMKE`) INNEN ELKERULT (2026-09-24,
  murena merese). A fenti JSDoc "harom hivohelyet" igert `status neutral`
  alakban, de a konstanst maga SEHOL nem importalta senki -- a `status`
  lapjai idokozben a megosztott `ServiceStatusBadge`-re alltak at
  (`@acropora/ui`, sajat `serviceToneClass` terkeppel), es a `.status`/
  `.status-*`/`.status.neutral` CSS-szabalyok is elkerultek a
  `globals.css`-bol, ugyanezen a meresen. A konstans holt kod volt: a
  felvaltott CSS-szabalyt semmi nem hasznalta.
*/

/*
  A `.muted` NEM KAPOTT KONSTANST, ES EZ MERESBOL KOVETKEZETT.

  Tizennegy hivohelye volt, es MIND azonos alaku: `<p className="muted">`. Ez
  tiszta szoveg-tulajdonsag (szin es sormagassag), nem keret-elem -- a ket
  tulajdonsag helyben all minden hivohelyen.

  ES EGY MEROHELY-HIBA, AMIT ERDEMES TUDNI: a `\bmuted\b` mintam eloszor
  HUSZAT adott, mert a `text-muted` Tailwind-tokenre is illeszkedett -- azt az
  elozo kor vitte be ugyanebbe a csomagba. A valodi szam tizennegy.

  A `.notice` OSZTALY, AMI A `.muted` SZABALYAT EGYUTT VITTE, IS ELKERULT
  (2026-09-24, murena merese): a sajat megjegyzese harom elo hivohelyet
  igert, de egyetlen `className="notice"` sem all a forrasban tobbe.
*/
