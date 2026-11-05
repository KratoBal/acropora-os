import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "./theme.css";
import "./jatek.css";

/**
 * A KET BETUTIPUS (DM Sans, Manrope), HELYBEN TAROLT FAJLBOL, mint az `apps/partner`-ben: nincs futasidejű vagy
 * epitesi idejű halozati letoltes (a prototipus Google Fonts-ot hasznalt). A fajlok betuszerint ugyanazok, mint a
 * partner appeé (`src/app/fonts/`, az OFL licenccel).
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
    default: "Acropora nyereményjáték",
    template: "%s · Acropora nyereményjáték",
  },
  description:
    "Merülj játékba az Acroporával: heti kérdések, heti ajándékok és egy Aquaforest AF Nano Tank fődíj.",
  // A teszten nem kell a keresobe; elesben a JATEK_INDEXABLE=true kapcsolja be.
  robots: { index: process.env.JATEK_INDEXABLE === "true" },
};

export const viewport: Viewport = { themeColor: "#070d13" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu" className={`${dmSans.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
