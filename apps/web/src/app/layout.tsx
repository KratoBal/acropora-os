import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";

/**
 * A KET BETUTIPUS Balazs 2026-09-15-i prototipusabol: a torzs DM Sans, a
 * cimek Manrope. A `latin-ext` reszhalmaz NEM elhagyhato: a magyar hosszu
 * kettos ekezetek ("ő" es "ű") csak abban vannak benne, es nelkule a bongeszo
 * pont azoknal a betuknel esne vissza egy masik betutipusra -- a szo kozepen
 * valtana a betukep.
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
