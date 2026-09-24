import localFont from "next/font/local";

/**
 * A FIGMA TERV INTER BETŰTÍPUST HASZNÁL, A MAI FELÜLET NEM (DM Sans/
 * Manrope, lásd `apps/web/src/app/layout.tsx`). A brief kifejezetten kéri:
 * "ha nem [használt ma], a kísérleti rétegben maradjon, ne cseréld az egész
 * appban" -- ezért ez a betűtípus csak a pilot-komponensek gyökér
 * elemére kerül fel (`pilotInter.className`), a root layout-hoz NEM nyúl.
 *
 * HELYBEN TAROLT FAJLBOL, NEM `next/font/google`-BOL, 2026-09-24 OTA -- a
 * teljes indoklas az `apps/web/src/app/layout.tsx` fejleceben all (a nem
 * determinisztikus build-idejü halozati letoltes miatt, ami a Docker/CI
 * buildet ugyanugy negyszer buktatta el, ahol ez a hivas is fut).
 *
 * A NEGY SULY (400/500/600/700) EGY TARTOMANY LETT, NEM VALTOZAS: az Inter
 * Google Fonts-nal MAGA IS valtozo (variable) font, es a negy "kulon"
 * statikus suly a CSS2 API valaszaban MAR EDDIG IS BYTE-RA AZONOS fajlra
 * mutatott (lemerve: mind a negy `font-weight` blokk ugyanazt a
 * `gstatic.com` URL-t adta latin es latin-ext reszhalmazonkent is) -- a
 * bongeszo tehat a negy nevezett sulyt is EGYETLEN valtozo fajlbol
 * allitotta elo mar korabban is. A `weight: "400 700"` tartomany ugyanezt
 * a viselkedest adja, csak kimondva.
 *
 * A GOOGLE/FONTS FORRAS-FAJL (`ofl/inter/Inter[opsz,wght].ttf`) A TELJES
 * KARAKTERKESZLETET HORDOZZA EGY FAJLBAN -- a magyar hosszú kettős ékezetek
 * ("ő", "ű") tehát továbbra is benne vannak, lásd a webes layout fejlécét,
 * miért nincs itt már külön `latin`/`latin-ext` felbontás.
 */
export const pilotInter = localFont({
  src: "./fonts/inter-variable.woff2",
  weight: "400 700",
  variable: "--font-pilot-inter",
});
