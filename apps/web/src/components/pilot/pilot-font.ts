import localFont from "next/font/local";

/**
 * INTER, AZ EGESZ OS BETUTIPUSA (UI-attekintes, 2026-11-03). A Figma terv Inter,
 * es mostantol a teljes webes app is az: a `apps/web/src/app/layout.tsx` ennek
 * a peldanynak a valtozo-osztalyat teszi a `<html>` elemre, a `web-font.css`
 * pedig a kozos tema `--font-dm-sans` es `--font-manrope` valtozoit erre
 * iranyitja. A pilot-komponensek gyokere tovabbra is `pilotInter.className`-et
 * kap, tehat egy fajl, egy betoltes.
 *
 * HELYBEN TAROLT FAJLBOL, NEM `next/font/google`-BOL, 2026-09-24 OTA: a
 * build-idejü halozati letoltes nem determinisztikus, es CI-ben ugyanugy
 * negyszer buktatta a buildet ugyanazon a SHA-n.
 *
 * A SULY-TARTOMANY EGY VALTOZO FAJL TELJES TARTOMANYA (100-900): a Manrope 800-as
 * cimsulya is (pl. `font-extrabold`) valodi Inter-sulyt kap, nem szorul 700-ra.
 * A google/fonts forras-fajl (`ofl/inter/Inter[opsz,wght].ttf`) a teljes
 * karakterkeszletet egy fajlban hordozza, a magyar hosszu kettos ekezetekkel
 * ("ő", "ű") egyutt.
 */
export const pilotInter = localFont({
  src: "./fonts/inter-variable.woff2",
  weight: "100 900",
  variable: "--font-pilot-inter",
});
