/**
 * A LAPMARGÓ EGY HELYEN (T1.2, kártya 9314b045). A keret (`apps/web/src/components/app-shell.tsx` `<main>`) ezzel adja a
 * margót minden lapnak, és a keret széléig érő (`bleed`) lapok sávjai is ezzel adják a sajátjukat. Eddig a bleed lapok
 * kézzel írták (`px-4 sm:px-8`, 53 helyen): 640 és 1024 px között 32 px volt a keret 24-e helyett, és egy rossz másolat
 * (sima `px-8`, vagy a keret paddingja mellé tett saját) 2026-11-03-án három PR-t kért (#2084, #2087).
 *
 * A KÉZI MÁSOLATOT az `apps/web/src/components/pilot/no-hand-written-page-gutter.test.ts` tiltja.
 *
 * MIÉRT SZÓ SZERINTI SZÖVEG, ÉS NEM SZÁMOLT: a Tailwind a forrásban álló osztályneveket gyűjti, egy összerakott
 * `-mx-${n}` nem kerül a CSS-be. Ezért a `PILOT_SHELL_BLEED` is kiírt szöveg, és a tükör-viszonyt a
 * `page-frame.test.ts` méri.
 */

/** A lap vízszintes margója: telefonon 16, sm-től 24, lg-től 32 px. */
export const PAGE_GUTTER_X = "px-4 sm:px-6 lg:px-8";

/** Ugyanaz a margó külső margóként, ahol a sáv háttere nem érhet a keret széléig. */
export const PAGE_GUTTER_MX = "mx-4 sm:mx-6 lg:mx-8";

/** A lap függőleges margója a keretben: 24, lg-től 32 px. */
export const PAGE_GUTTER_Y = "py-6 lg:py-8";

/**
 * A LAP TELJES SZÉLESSÉGŰ HÁTTERE: a keret margójának (`PAGE_GUTTER_X` és `PAGE_GUTTER_Y`) pontos negatív tükre, minden
 * töréspontra (UI 1. csomag, 2026-11-03). A lapok korábban kézzel `-m-6`-ot adtak, ami telefonon 8 px-szel több volt a
 * keret 16 px-énél: a lap 398 px széles lett 390-en (mérve a stage-en 15 lapon).
 */
export const PILOT_SHELL_BLEED = "-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8";

/** Egy padding-osztály negatív margó-tükre (`sm:px-6` -> `sm:-mx-6`); a teszt és a keret őrzője használja. */
export function bleedMirror(paddingClass: string): string {
  const m = /^((?:sm|md|lg|xl|2xl):)?p([xy])-(.+)$/.exec(paddingClass);
  if (!m) throw new Error(`not a padding class: ${paddingClass}`);
  return `${m[1] ?? ""}-m${m[2]}-${m[3]}`;
}
