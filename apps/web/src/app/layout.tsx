import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";

/**
 * A KET BETUTIPUS Balazs 2026-09-15-i prototipusabol: a torzs DM Sans, a
 * cimek Manrope.
 *
 * HELYBEN TAROLT FAJLBOL, NEM `next/font/google`-BOL, 2026-09-24 OTA.
 *
 * === MIERT: A HALOZATI LETOLTES NEM DETERMINISZTIKUS A BUILD ALATT ===
 *
 * Merve (acrobot, 2026-09-24): a webes build NEGYSZER bukott el ugyanazon a
 * SHA-n, CI-ben ES a Docker buildben is, "next/font/google queries have
 * exactly one entry" / "Can't resolve
 * '@vercel/turbopack-next/internal/font/google/font'" hibaval -- majd egy
 * MASIK futas UGYANARRA a SHA-ra zold volt. A `next/font/google` build
 * idoben tenyleg letolti a betutipust a Google szervererol (Turbopack
 * internal modulon at), es ez a haloizati hivas a CI-ben es az eles Coolify
 * web buildben (ugyanaz a build fut ott is) IDONKENT elhasal -- nem a
 * kodunk hibaja, hanem egy build-idejü halozati fuggoseg, ami eles
 * telepitest is elvihet.
 *
 * A MEGOLDAS: a betutipus-fajl MAGA A REPOBAN all (`./fonts/*.woff2`), a
 * build tehat semmit nem tolt le a halozatrol ehhez. A fajlok a Google
 * Fonts hivatalos forras-repojabol jonnek (github.com/google/fonts,
 * `ofl/dmsans/DMSans[opsz,wght].ttf` es `ofl/manrope/Manrope[wght].ttf`),
 * woff2-re tomoritve -- UGYANAZ a betukep-adat, mint amit a
 * `next/font/google` letoltott volna, csak build-idoben mar helyben all.
 *
 * A VALTOZO SULY-TARTOMANY VALTOZATLAN: mind a ket betutipus valtozo
 * (variable) font, es a `next/font/google` hivas korabban SEM adott meg
 * `weight`-et -- ez azt jelentette, hogy a TELJES sulytartomanyt kapta meg a
 * bongeszo (`font-weight: 100 1000` DM Sans-nal, `font-weight: 200 800`
 * Manrope-nal, lemerve a Google Fonts CSS2 API valaszabol). A `weight`
 * mezo itt ugyanezt a ket tartomanyt adja at -- a megjelenes nem valtozik.
 *
 * A `latin-ext` RESZHALMAZ-SZUKITES NEM ALL FENN TOBBE, ES EZ SZANDEKOS:
 * a `next/font/local` NEM tamogat unicode-range-alapu tobb-fajlos
 * felbontast egyetlen hivason belul (csak `path`/`weight`/`style`
 * kulcsokat fogad `src` tombkent). A googe/fonts forras-fajl viszont a
 * TELJES karakterkeszletet (latin + latin-ext + tobbi irasrendszer) EGY
 * fajlban hordozza -- a magyar hosszu kettos ekezetek ("ő", "ű") tehat
 * TOVABBRA IS benne vannak, csak nem kulon toltodo reszkent, hanem a fajl
 * reszekent mindig egyutt.
 */
const dmSans = localFont({
  src: "./fonts/dm-sans-variable.woff2",
  weight: "100 1000",
  variable: "--font-dm-sans",
});

const manrope = localFont({
  src: "./fonts/manrope-variable.woff2",
  weight: "200 800",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: {
    default: "Acropora OS",
    template: "%s · Acropora OS",
  },
  description: "Magyar nyelvű vállalatirányítási rendszer",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="hu">
      <body className={`${dmSans.variable} ${manrope.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
