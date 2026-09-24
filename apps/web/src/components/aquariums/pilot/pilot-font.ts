import { Inter } from "next/font/google";

/**
 * A FIGMA TERV INTER BETŰTÍPUST HASZNÁL, A MAI FELÜLET NEM (DM Sans/
 * Manrope, lásd `apps/web/src/app/layout.tsx`). A brief kifejezetten kéri:
 * "ha nem [használt ma], a kísérleti rétegben maradjon, ne cseréld az egész
 * appban" -- ezért ez a betűtípus csak a pilot-komponensek gyökér
 * elemére kerül fel (`pilotInter.className`), a root layout-hoz NEM nyúl.
 *
 * A `latin-ext` ALSZAKASZ NEM ELHAGYHATÓ: a magyar hosszú kettős ékezetek
 * ("ő", "ű") csak abban vannak benne -- ugyanaz a korlát, amit a mai
 * DM Sans/Manrope betöltés fejléce is megnevez. A Figma export nyers
 * Google Fonts `@import`-ja ("family=Inter:wght@400;450;500;600;700") ezt
 * NEM adja meg, tehát ha onnan másolnánk át változatlanul, a hosszú
 * ékezetes betűk a szó közepén váltanának képet egy tartalék betűtípusra.
 */
export const pilotInter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-pilot-inter",
});
