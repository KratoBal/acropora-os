import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * The same two typefaces and variable names as apps/web and apps/partner
 * (`packages/ui/src/theme.css` points at `--font-dm-sans` and `--font-manrope`).
 * Local files, not `next/font/google`: a network download at build time is not
 * deterministic. The files are a deliberate copy, as in apps/partner: every
 * app is its own Next build root.
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
  title: { default: "ReefClub", template: "%s · ReefClub" },
  description: "Akváriumok, mérések és a bolti kapcsolat egy helyen.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu">
      <body className={`${dmSans.variable} ${manrope.variable}`}>
        {children}
      </body>
    </html>
  );
}
