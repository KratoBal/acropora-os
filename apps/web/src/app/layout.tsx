import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./web-font.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { pilotInter } from "@/components/pilot/pilot-font";

/**
 * EGY BETUTIPUS AZ EGESZ OS-BEN: INTER (UI-attekintes, Balazs 2026-11-03).
 *
 * Eddig a torzs DM Sans, a cimek Manrope volt, a Pilot-felulet (a Figma terv)
 * viszont Inter -- ugyanazon az oldalon harom betutipus keveredett. Mostantol a
 * teljes webes app Inter. A betutipus-fajl MAGA A REPOBAN all es a
 * `next/font/local` toltik be (a `pilot-font.ts` ugyanazon peldanya), tehat a
 * build semmit nem tolt le a halozatrol: a 2026-09-24-i indoklas (a
 * `next/font/google` build-idejü letoltese nem determinisztikus) valtozatlanul
 * all.
 *
 * A KOZOS `theme.css` a `--font-dm-sans` es `--font-manrope` valtozokra
 * hivatkozik (az `apps/partner` es az `apps/reefclub` ott tolti be oket, es
 * azok valtozatlanok maradnak). A webes app itt nem tolti be oket, hanem a
 * `web-font.css` az Inter valtozojara iranyitja mindkettot. A valtozo-osztaly
 * a `<html>` elemen all, mert a `:root` felulirasnak ott kell latnia.
 */

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
    <html lang="hu" className={pilotInter.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
