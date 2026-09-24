import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth";
import "./globals.css";

/**
 * UGYANAZ A KET BETUTIPUS ES UGYANAZOK A VALTOZO-NEVEK, MINT `apps/web`-en
 * (2026-09-24) -- a `packages/ui/src/theme.css` `--font-sans`/`--font-display`
 * tokenjei ezekre a nevekre hivatkoznak (`var(--font-dm-sans)`,
 * `var(--font-manrope)`), tehat a betutipus-valtozokat MINDKET appnak
 * ugyanazzal a nevvel kell a `body`-ra tennie.
 *
 * HELYBEN TAROLT FAJLBOL, NEM `next/font/google`-BOL, 2026-09-24 OTA -- a
 * teljes indoklas az `apps/web/src/app/layout.tsx` fejleceben all (a nem
 * determinisztikus build-idejü halozati letoltes miatt). A ket fajl BETURE
 * UGYANAZ, mint a webes appe (`../../../web/src/app/fonts/*.woff2` --
 * SZANDEKOSAN KULON MASOLAT, nem megosztott import: a ket app kulon Next.js
 * build-gyoker, es a `next/font/local` `src` utvonala a hivo fajlhoz
 * kepest ertelmezodik).
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
  title: { default: "Acropora Szerviz", template: "%s · Acropora Szerviz" },
  description: "Partneri hibajegy-kezelő felület",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu">
      <body className={`${dmSans.variable} ${manrope.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
