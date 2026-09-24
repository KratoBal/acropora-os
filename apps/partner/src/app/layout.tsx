import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth";
import "./globals.css";

/**
 * UGYANAZ A KET BETUTIPUS ES UGYANAZOK A VALTOZO-NEVEK, MINT `apps/web`-en
 * (2026-09-24) -- a `packages/ui/src/theme.css` `--font-sans`/`--font-display`
 * tokenjei ezekre a nevekre hivatkoznak (`var(--font-dm-sans)`,
 * `var(--font-manrope)`), tehat a betutipus-valtozokat MINDKET appnak
 * ugyanazzal a nevvel kell a `body`-ra tennie. A `latin-ext` reszhalmaz itt
 * is kotelezo, ugyanazon okbol, mint a webes oldalon: a magyar hosszu kettos
 * ekezetek ("ő", "ű") csak abban vannak benne.
 */
const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-sans",
});

const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
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
